import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import SimpleAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ContractFactory } from 'ethers';
import { linkedByteCode, assertRevert, walletWithEthAndProvider as wallet, getNetworkId, ganacheProvider as provider } from 'magmo-devtools';

import { channel, alice, bob, aliceDest } from "./test-scenarios";
import { sign } from "fmg-core";

import { soliditySha3 } from "web3-utils";


jest.setTimeout(20000);
let turbo;

const DEPOSIT_AMOUNT = 255; // 
const SMALL_WITHDRAW_AMOUNT = 10;

const MESSAGE = soliditySha3("foo");

function depositTo(destination, amount=DEPOSIT_AMOUNT, value=DEPOSIT_AMOUNT): Promise<any> {
  return turbo.deposit(destination, amount, { value: DEPOSIT_AMOUNT });
}

async function withdraw(participant, destination, signer=participant, amount=DEPOSIT_AMOUNT): Promise<any> {
  const sig: any = sign(MESSAGE, signer.privateKey);
  return turbo.withdraw(participant.address, destination, amount, sig.messageHash, sig.v, sig.r, sig.s, { gasLimit: 3000000 });
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

      expect(allocatedAmount.toNumber()).toEqual(DEPOSIT_AMOUNT);
    });

    it("requires deposit amount to match msg.value", async () => {
      // should fail
      await depositTo(channel.id, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT + 1);
    });
  });

  describe("withdraw", () => {
    it.skip("works when allocations[fromParticipant] >= amount and sent on behalf of fromParticipant", async () => {
      await depositTo(alice.address);

      const startBal = await provider.getBalance(aliceDest.address);
      const allocatedAtStart = await turbo.allocations(alice.address); // should be at least DEPOSIT_AMOUNT, regardless of test ordering

      // Alice can withdraw some of her money
      await withdraw(alice, aliceDest.address, alice, SMALL_WITHDRAW_AMOUNT);

      expect(Number(await provider.getBalance(aliceDest.address))).toEqual(Number(startBal.add(SMALL_WITHDRAW_AMOUNT)));
      expect(Number(await turbo.allocations(alice.address))).toEqual(Number(allocatedAtStart - SMALL_WITHDRAW_AMOUNT));

      // Alice should be able to withdraw all remaining funds allocated to her.
      await withdraw(alice, aliceDest.address, alice, allocatedAtStart - SMALL_WITHDRAW_AMOUNT);

      expect(Number(await provider.getBalance(aliceDest.address))).toEqual(Number(await provider.getBalance(aliceDest.address)));
      expect(Number(await turbo.allocations(alice.address))).toEqual(0);
    });

    it("reverts when allocations[fromParticipant] > amount but not sent on behalf of fromParticipant", async () => {
      await delay();
      await depositTo(alice.address);
      assertRevert(withdraw(alice, aliceDest.address, bob), "Withdraw: not authorized by fromParticipant");
      await delay();
    });

    it("reverts when sent on behalf of fromParticipant but allocations[fromParticipant] < amount", async () => {
      await delay(2000);
      await depositTo(alice.address);
      const allocated = await turbo.allocations(alice.address); // should be at least DEPOSIT_AMOUNT, regardless of test ordering
      await delay();
      assertRevert(withdraw(alice, aliceDest.address, alice, Number(allocated) + 100000));
    });
  });
});

function delay(ms=1000) {
    return new Promise(resolve => { setTimeout(resolve, ms); });
}