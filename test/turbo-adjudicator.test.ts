import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import SimpleAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ContractFactory } from 'ethers';
import { linkedByteCode, expectRevert, walletWithEthAndProvider as wallet, getNetworkId, ganacheProvider as provider  } from 'magmo-devtools';

import { channel, } from "./test-scenarios";

jest.setTimeout(20000);
let turbo;

const DEPOSIT_AMOUNT = 20;
const SMALL_WITHDRAW_AMOUNT = 10;
const LARGE_WITHDRAW_AMOUNT = 30;

function depositTo(destination, amount=DEPOSIT_AMOUNT, value=DEPOSIT_AMOUNT): Promise<any> {
  return turbo.deposit(destination, DEPOSIT_AMOUNT, { value: DEPOSIT_AMOUNT });
}

describe('SimpleAdjudicator', () => {
  beforeEach(async () => {
    const networkId = await getNetworkId();

    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, StateArtifact, networkId);
    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, RulesArtifact, networkId);

    turbo = await ContractFactory.fromSolidity(SimpleAdjudicatorArtifact, wallet).deploy();
  });

  describe("deposit", () => {
    it("works", async () => {
      await depositTo(channel.id);
      const allocatedAmount  = await turbo.allocations(channel.id);

      expect(allocatedAmount.toNumber()).toEqual(20);
    });

    it("requires deposit amount to match msg.value", async () => {
      expectRevert(depositTo(channel.id, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT + 1), "deposit amount must match msg.value");
    });
  });

  describe("withdraw", () => {
    it("works when allocations[fromParticipant] >= amount and sent on behalf of fromParticipant", async () => {
      await depositTo(alice.address);

      const startBal = await provider.getBalance(aliceDest.address);
      const allocatedAtStart = await turbo.allocations(alice.address); // should be at least DEPOSIT_AMOUNT, regardless of test ordering

      await turbo.withdraw(alice.address, aliceDest.address, SMALL_WITHDRAW_AMOUNT, alice.signature);

      expect(await provider.getBalance(aliceDest.address)).toEqual(startBal + SMALL_WITHDRAW_AMOUNT);
      expect(await turbo.allocations(alice.address)).toEqual(allocatedAtStart - SMALL_WITHDRAW_AMOUNT);

      // Alice should be able to withdraw all remaining funds allocated to her.
      await turbo.withdraw(alice.address, aliceDest.address, allocatedAtStart - SMALL_WITHDRAW_AMOUNT, alice.signature);
    });

    it("reverts when allocations[fromParticipant] > amount but not sent on behalf of fromParticipant", async () => {
      await depositTo(alice.address);
      expectRevert(turbo.withdraw(alice.address, aliceDest.address, SMALL_WITHDRAW_AMOUNT, bob.signature), "Withdraw: not authorized by fromParticipant");
    });

    it("reverts when sent on behalf of fromParticipant but allocations[fromParticipant] < amount", async () => {
      await depositTo(alice.address);
      expectRevert(turbo.withdraw(alice.address, aliceDest.address, LARGE_WITHDRAW_AMOUNT, alice.signature), "Withdraw: overdrawn");
    });
  });
});
