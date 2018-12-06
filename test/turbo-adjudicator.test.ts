import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import TurboAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ContractFactory, ethers } from 'ethers';
import {
  linkedByteCode,
  assertRevert,
  getWalletWithEthAndProvider,
  getNetworkId,
  getGanacheProvider,
} from 'magmo-devtools';

import { channel, alice, bob, aliceDest, resolution } from './test-scenarios';
import { sign } from 'fmg-core';

jest.setTimeout(20000);
let turbo;
const abiCoder = new ethers.utils.AbiCoder();
const wallet = getWalletWithEthAndProvider();
const provider = getGanacheProvider();

const DEPOSIT_AMOUNT = 255; //
const SMALL_WITHDRAW_AMOUNT = 10;

const AUTH_TYPES = ['address', 'uint256', 'uint256'];

function depositTo(destination, value = DEPOSIT_AMOUNT): Promise<any> {
  return turbo.deposit(destination, { value });
}

async function withdraw(
  participant,
  destination,
  signer = participant,
  amount = DEPOSIT_AMOUNT,
): Promise<any> {
  const accountNonce = Number(await turbo.withdrawalNonce(participant.address));
  const authorization = abiCoder.encode(AUTH_TYPES, [destination, amount, accountNonce]);

  const sig = sign(authorization, signer.privateKey);
  return turbo.withdraw(
    participant.address,
    destination,
    amount,
    authorization,
    sig.v,
    sig.r,
    sig.s,
    { gasLimit: 3000000 },
  );
}

describe('TurboAdjudicator', () => {
  beforeAll(async () => {
    const networkId = await getNetworkId();

    TurboAdjudicatorArtifact.bytecode = linkedByteCode(TurboAdjudicatorArtifact, StateArtifact, networkId);
    TurboAdjudicatorArtifact.bytecode = linkedByteCode(TurboAdjudicatorArtifact, RulesArtifact, networkId);

    turbo = await ContractFactory.fromSolidity(TurboAdjudicatorArtifact, wallet).deploy();
  });

  describe('deposit', () => {
    it('works', async () => {
      await depositTo(channel.channelType);
      const allocatedAmount = await turbo.allocations(channel.channelType);

      expect(allocatedAmount.toNumber()).toEqual(DEPOSIT_AMOUNT);
    });
  });

  describe('withdraw', () => {
    it('works when allocations[fromParticipant] >= amount and sent on behalf of fromParticipant', async () => {
      await depositTo(alice.address);

      const startBal = await provider.getBalance(aliceDest.address);
      const allocatedAtStart = await turbo.allocations(alice.address); // should be at least DEPOSIT_AMOUNT, regardless of test ordering
      const withdrawalNonce = await turbo.withdrawalNonce(alice.address);

      // Alice can withdraw some of her money
      await withdraw(alice, aliceDest.address, alice, SMALL_WITHDRAW_AMOUNT);

      expect(Number(await provider.getBalance(aliceDest.address))).toEqual(
        Number(startBal.add(SMALL_WITHDRAW_AMOUNT)),
      );
      expect(Number(await turbo.allocations(alice.address))).toEqual(
        Number(allocatedAtStart - SMALL_WITHDRAW_AMOUNT),
      );
      expect(await turbo.withdrawalNonce(alice.address)).toEqual(withdrawalNonce.add(1));

      // Alice should be able to withdraw all remaining funds allocated to her.
      await withdraw(alice, aliceDest.address, alice, allocatedAtStart - SMALL_WITHDRAW_AMOUNT);

      expect(Number(await provider.getBalance(aliceDest.address))).toEqual(
        Number(await provider.getBalance(aliceDest.address)),
      );
      expect(Number(await turbo.allocations(alice.address))).toEqual(0);
      expect(await turbo.withdrawalNonce(alice.address)).toEqual(withdrawalNonce.add(2));
    });

    it('reverts when allocations[fromParticipant] > amount but not sent on behalf of fromParticipant', async () => {
      await delay();
      await depositTo(alice.address);
      assertRevert(
        withdraw(alice, aliceDest.address, bob),
        'Withdraw: not authorized by fromParticipant',
      );
      await delay();
    });

    it('reverts when sent on behalf of fromParticipant but allocations[fromParticipant] < amount', async () => {
      await delay(2000);
      await depositTo(alice.address);
      await delay();
      const allocated = await turbo.allocations(alice.address); // should be at least DEPOSIT_AMOUNT, regardless of test ordering
      assertRevert(withdraw(alice, aliceDest.address, alice, Number(allocated) + 100000));
      await delay();
    });
  });

  describe('setOutcome', () => {
    // TODO: Temporary tests, remove later
    it('works', async () => {
      await delay();
      const outcome = [[alice.address, bob.address], resolution, false];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();
      await delay();

      const setOutcome = await turbo.getOutcome(channel.channelType);
      expect(setOutcome).toMatchObject({
        destination: [alice.address, bob.address],
        amount: resolution,
        isFinal: false,
      });
      await delay();
    });
  });

  describe('transfer', () => {
    it('works when \
        the outcome is final and \
        outcomes[fromChannel].destination is covered by allocations[fromChannel]', async () => {
      await depositTo(channel.channelType);
      await delay();

      const outcome = [[alice.address, bob.address], resolution, true];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();

      const allocatedToChannel = await turbo.allocations(channel.channelType);
      const allocatedToAlice = await turbo.allocations(alice.address);

      await turbo.transfer(channel.channelType, alice.address, resolution[0]);

      expect(await turbo.allocations(alice.address)).toEqual(allocatedToAlice.add(resolution[0]));
      expect(await turbo.allocations(channel.channelType)).toEqual(allocatedToChannel.sub(resolution[0]));

      await delay();
    });

    it('reverts when the outcome is not final', async () => {
      const outcome = [[alice.address, bob.address], resolution, false];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();

      assertRevert(
        turbo.transfer(channel.channelType, aliceDest.address, resolution[0]),
        "Transfer: outcome must be final"
      );

      await delay(100);
    });

    it('reverts when the outcome is final but the destination is not covered', async () => {
      const allocated = await turbo.allocations(channel.channelType);
      const outcome = [[alice.address, bob.address], [allocated.add(1), resolution[1]], true];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();

      assertRevert(
        turbo.transfer(channel.channelType, alice.address, allocated.add(1)),
        "Transfer: allocations[channel] must cover transfer"
      );

      await delay(1000);
    });

    it('reverts when the outcome is final \
             and the destination is covered by allocations[channel] \
             but outcome.amount[destination] < amount', async () => {
      await turbo.deposit(channel.channelType, { value: resolution[0].add(resolution[1])});

      const outcome = [[alice.address, bob.address], resolution, true];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();

      assertRevert(
        turbo.transfer(channel.channelType, alice.address, resolution[0].add(1)),
        "Transfer: transfer too large"
      );

      await delay(1000);
    });

    it('reverts when the destination is not in outcome.destination', async () => {
      await turbo.deposit(channel.channelType, { value: resolution[0].add(resolution[1])});

      const outcome = [[alice.address, bob.address], resolution, true];
      const tx = await turbo.setOutcome(channel.channelType, outcome);
      await tx.wait();

      assertRevert(
        turbo.transfer(channel.channelType, aliceDest.address, resolution[0].add(1)),
        "Transfer: destination not in outcome"

      );

      await delay(1000);
    });
  });
});

function delay(ms = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
