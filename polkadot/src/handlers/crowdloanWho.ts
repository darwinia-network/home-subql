import {
  CrowdloanWhoStatistics
} from '../types';

export class CrowdloanWho {
  static async ensure(id: string) {
    const target = await CrowdloanWhoStatistics.get(id);

    if (!target) {
      const statistics = new CrowdloanWhoStatistics(id);

      statistics.totalBalance = BigInt(0);
      statistics.totalPower = BigInt(0);
      statistics.user = id;

      await statistics.save();

      return statistics;
    }
  }

  static async update(id: string, balance: bigint, power: bigint) {
    const target = await CrowdloanWhoStatistics.get(id);

    target.totalBalance = target.totalBalance + balance;
    target.totalPower = target.totalPower + power;

    await target.save();
  }
}
