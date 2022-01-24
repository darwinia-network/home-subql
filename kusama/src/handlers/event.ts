import { SubstrateBlock, SubstrateEvent } from '@subql/types';
import { Block, CrowdloanContributed, CrowdloanMemo } from '../types';
import { AccountHandler } from './account';
import { CrowdloanWho } from './crowdloanWho';
import { CrowdloanRefer } from './crowdloanRefer';

// < REWARD_EARLY_END_BLOCK 1.2
// REWARD_EARLY_END_BLOCK < block_number < WIN_END_PERIOD_START_BLOCK: 1
// WIN_END_PERIOD_START_BLOCK < block_number < WIN_END_PERIOD_EDN_BLOCK:  线性递减 1 -> 0 e.g: 1000 --- 10000 10001  length: 10000 - 10000 = 9000 10000 -10001 = 89999 powerBaseWeight = 8999/9000  power = powerBaseWeight * amount
const REWARD_EARLY_END_BLOCK = BigInt(10914000);
const WIN_END_PERIOD_START_BLOCK = BigInt(11014800);
const WIN_END_PERIOD_END_BLOCK = BigInt(11087040);
const PARA_ID = 2105;

const TOP_TEN = [];

export class EventHandler {
  private event: SubstrateEvent;

  constructor(event: SubstrateEvent) {
    this.event = event;
  }

  get index() {
    return this.event.idx;
  }

  get blockNumber() {
    return this.event.block.block.header.number.toNumber();
  }

  get blockHash() {
    return this.event.block.block.hash.toString();
  }

  get events() {
    return this.event.block.events;
  }

  get section() {
    return this.event.event.section;
  }

  get method() {
    return this.event.event.method;
  }

  get data() {
    return this.event.event.data.toString();
  }

  get extrinsicHash() {
    const i = this.event?.extrinsic?.extrinsic?.hash?.toString();

    return i === 'null' ? undefined : i;
  }

  get id() {
    return `${this.blockNumber}-${this.index}`;
  }

  get timestamp() {
    return this.event.block.timestamp;
  }

  public async save() {
    if (
      this.section !== 'crowdloan' ||
      (this.section === 'crowdloan' && this.method === 'create')
    ) {
      return;
    }

    const {
      event: { method },
    } = this.event;

    if (method === 'MemoUpdated') {
      await this.handleMemoUpdate(this.event);
    }

    if (method === 'Contributed') {
      await this.ensureMemoUpdated();

      await this.handleContributed();
    }
  }

  private async handleMemoUpdate({
    event: { data, method },
    block,
  }: Pick<SubstrateEvent, 'event' | 'block'>) {
    const { timestamp } = block;
    const [account, paraId, memo] = JSON.parse(data.toString());

    if (paraId !== PARA_ID) {
      return;
    }

    const instance = new CrowdloanMemo(account);

    instance.who = account;
    instance.paraId = paraId;
    instance.memo = memo;
    instance.timestamp = timestamp;
    instance.block = this.simpleBlock(block);

    try {
      await instance.save();
    } catch (error) {
      logger.info('CrowdloanHandler error method: ', method);
    }
  }

  private async ensureMemoUpdated() {
    const { event, block } = this.event;
    const [account] = JSON.parse(event.data.toString()) as [string, number, number];
    const target = await CrowdloanMemo.get(account);

    if (!target) {
      const memoEvent = block.events.find((item) => item.event.method === 'MemoUpdated');

      if (memoEvent) {
        await this.handleMemoUpdate({ event: memoEvent.event, block });
      }
    }
  }

  private async handleContributed() {
    const {
      event: { data, method },
      block: { timestamp, block },
      idx,
    } = this.event;
    const [account, paraId, amount] = JSON.parse(data.toString()) as [string, number, number];

    if (paraId !== PARA_ID) {
      return;
    }

    const balance = BigInt(amount);

    await AccountHandler.ensureAccount(account);
    await AccountHandler.updateCrowdloanStatistic(account, balance);

    const refer = (await CrowdloanMemo.get(account))?.memo || null;
    const blockNumber = block.header.number.toBigInt();
    const powerBase = this.calcPowerBase(blockNumber, balance);
    const powerWho = powerBase + (!refer ? BigInt(0) : powerBase / BigInt(20));
    const powerRefer = !refer ? BigInt(0) : this.calcReferReward(powerBase, account);
    const instance = new CrowdloanContributed(
      block.header.number.toString() + '-' + idx.toString(10)
    );

    await CrowdloanWho.ensure(account);
    await CrowdloanWho.update(account, balance, powerWho);

    if (refer) {
      instance.referStatisticsId = refer;

      await CrowdloanRefer.ensure(refer);
      await CrowdloanRefer.update(refer, balance, powerRefer);
    }

    instance.who = account;
    instance.refer = refer;
    instance.balance = balance;
    instance.powerWho = powerWho;
    instance.powerRefer = powerRefer;
    instance.paraId = paraId;
    instance.timestamp = timestamp;
    instance.whoStatisticsId = account;
    instance.extrinsicId = this.extrinsicHash;
    instance.block = this.simpleBlock(this.event.block);

    try {
      await instance.save();
    } catch (error) {
      logger.info('CrowdloanHandler error method: ', method);
    }
  }

  private simpleBlock(block: SubstrateBlock): Block {
    return {
      hash: block.hash.toString(),
      number: block.block.header.number.toNumber(),
      specVersion: block.specVersion,
    };
  }

  private calcPowerBase(blockNumber: bigint, amount: bigint): bigint {
    if (blockNumber < REWARD_EARLY_END_BLOCK) {
      return amount + amount / BigInt(5);
    }

    if (blockNumber > REWARD_EARLY_END_BLOCK && blockNumber < WIN_END_PERIOD_START_BLOCK) {
      return amount;
    }

    if (blockNumber > WIN_END_PERIOD_START_BLOCK && blockNumber < WIN_END_PERIOD_END_BLOCK) {
      const powerWeight =
        (WIN_END_PERIOD_END_BLOCK - WIN_END_PERIOD_START_BLOCK) /
        (WIN_END_PERIOD_END_BLOCK - blockNumber);

      return amount * powerWeight;
    }

    return BigInt(0);
  }

  private calcReferReward(powerBase: bigint, account: string): bigint {
    const index = TOP_TEN.findIndex((item) => item === account);
    const precision = 9;

    if (index === 0) {
      return powerBase * BigInt(100 ) / BigInt(8);
    }

    if (index > 0 && index < 5) {
      return powerBase * BigInt(100) / BigInt(7);
    }

    if (index >= 5) {
      return powerBase * BigInt(100) / BigInt(6);
    }

    return powerBase * BigInt(100) / BigInt(5);
  }
}
