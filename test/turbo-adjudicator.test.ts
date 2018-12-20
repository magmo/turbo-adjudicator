import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import TurboAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ContractFactory, ethers } from 'ethers';
import {
  linkedByteCode,
  assertRevert,
  getNetworkId,
  getGanacheProvider,
  expectEvent,
  increaseTime,
  DURATION
} from 'magmo-devtools';

import { channel, alice, bob, aliceDest, resolution, conclusionProof, state0, state1, state2, state3 } from './test-scenarios';
import { sign } from 'fmg-core';

jest.setTimeout(20000);
let turbo;
const abiCoder = new ethers.utils.AbiCoder();
const provider = getGanacheProvider();
const providerSigner = provider.getSigner();

const DEPOSIT_AMOUNT = 255; //
const SMALL_WITHDRAW_AMOUNT = 10;

let nullOutcome;
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

async function setupContracts() {
  const networkId = await getNetworkId();

  TurboAdjudicatorArtifact.bytecode = linkedByteCode(
    TurboAdjudicatorArtifact,
    StateArtifact,
    networkId,
  );
  TurboAdjudicatorArtifact.bytecode = linkedByteCode(
    TurboAdjudicatorArtifact,
    RulesArtifact,
    networkId,
  );

  turbo = await ContractFactory.fromSolidity(TurboAdjudicatorArtifact, providerSigner).deploy();
  await turbo.deployed();

  const unwrap = ({challengeState, finalizedAt }) => ({challengeState, finalizedAt});
  nullOutcome = { amount: [], destination: [], ...unwrap(await turbo.outcomes(turbo.address))};
}

describe('TurboAdjudicator', () => {
  beforeAll(async () => {
    await setupContracts(); 
  });

  describe('Eth management', () => {
    describe('deposit', () => {
      it('works', async () => {
        await depositTo(channel.id);
        const allocatedAmount = await turbo.allocations(channel.id);

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
      it('works', async () => { 
        await delay();
        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(0),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();
        await delay();

        const setOutcome = await turbo.getOutcome(channel.id);
        expect(setOutcome).toMatchObject(outcome);
        await delay();
      });
    });

    describe('transfer', () => {
      it('works when \
          the outcome is final and \
          outcomes[fromChannel].destination is covered by allocations[fromChannel]', async () => {
        await depositTo(channel.id);
        await delay();

        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(1),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        const allocatedToChannel = await turbo.allocations(channel.id);
        const allocatedToAlice = await turbo.allocations(alice.address);

        await turbo.transfer(channel.id, alice.address, resolution[0]);

        expect(await turbo.allocations(alice.address)).toEqual(allocatedToAlice.add(resolution[0]));
        expect(await turbo.allocations(channel.id)).toEqual(
          allocatedToChannel.sub(resolution[0]),
        );

        await delay();
      });

      it('reverts when the outcome is not final', async () => {
        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(Date.now() + 1000),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        assertRevert(
          turbo.transfer(channel.id, aliceDest.address, resolution[0]),
          'Transfer: outcome must be final',
        );

        await delay(100);
      });

      it('reverts when the outcome is final but the destination is not covered', async () => {
        const allocated = await turbo.allocations(channel.id);
        const outcome = {
          destination: [alice.address, bob.address],
          amount: [allocated.add(1), resolution[1]],
          finalizedAt: ethers.utils.bigNumberify(1),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        assertRevert(
          turbo.transfer(channel.id, alice.address, allocated.add(1)),
          'Transfer: allocations[channel] must cover transfer',
        );

        await delay(1000);
      });

      it('reverts when the outcome is final \
              and the destination is covered by allocations[channel] \
              but outcome.amount[destination] < amount', async () => {
        await turbo.deposit(channel.id, { value: resolution[0].add(resolution[1]) });

        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(1),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        assertRevert(
          turbo.transfer(channel.id, alice.address, resolution[0].add(1)),
          'Transfer: transfer too large',
        );

        await delay(1000);
      });

      it('reverts when the destination is not in outcome.destination', async () => {
        await turbo.deposit(channel.id, { value: resolution[0].add(resolution[1]) });

        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(1),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        assertRevert(
          turbo.transfer(channel.id, aliceDest.address, resolution[0]),
          'Transfer: destination not in outcome',
        );

        await delay(1000);
      });

      it('reverts when finalizedAt is 0', async () => {
        await turbo.deposit(channel.id, { value: resolution[0].add(resolution[1]) });

        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(0),
          challengeState: state0.asEthersObject,
        };
        const tx = await turbo.setOutcome(channel.id, outcome);
        await tx.wait();

        assertRevert(
          turbo.transfer(channel.id, alice.address, resolution[0]),
          'Transfer: outcome must be present',
        );

        await delay(1000);
      });
    });
  });

  describe('ForceMove Protocol', () => {
    const proof = conclusionProof();
    const challengee = alice;
    const challenger = bob;

    beforeAll(async () => {
      await setupContracts();
    });

    beforeEach(async () => {
      await (await turbo.setOutcome(channel.id, nullOutcome)).wait();
      // challenge doesn't exist at start of game
      expect(
        await turbo.isChannelClosed(channel.id)
      ).toBe(false);
    });

    describe('conclude', () => {
      it('works when the conclusion proof is valid', async () => {
        await delay();
        const { destination: startDestination, amount: startAmount, challengeState: startState, finalizedAt } = await turbo.getOutcome(channel.id);
        expect({ destination: startDestination, amount: startAmount, challengeState: startState, finalizedAt }).toMatchObject(nullOutcome);

        const tx = await turbo.conclude(proof);
        await tx.wait();
        await delay();

        const { destination, amount, challengeState } = await turbo.getOutcome(channel.id);

        expect(destination).toEqual([alice.address, bob.address]);
        expect(amount).toEqual(resolution);
        expect(challengeState).toMatchObject(proof.penultimateState);
        // TODO: figure out how to test finalizedAt

      });

      it('reverts if it has already been concluded', async () => {
        const tx = await turbo.conclude(proof);
        await tx.wait();

        assertRevert(
          turbo.conclude(proof),
          "Conclude: channel must not be finalized"
        );
        await delay();
      });
    });

    describe('forceMove', () => {
      it('emits ForceMove', async () => {
        const agreedState = state0;
        const challengeState = state1;
    
        const { r: r0, s: s0, v: v0 } = sign(agreedState.toHex(), challengee.privateKey);
        const { r: r1, s: s1, v: v1 } = sign(challengeState.toHex(), challenger.privateKey);
        const signatures = [
          { r: r0, s: s0, v: v0 },
          { r: r1, s: s1, v: v1 }
        ];

        expect(await turbo.outcomeFinal(channel.id)).toBe(false);
    
        const filter = turbo.filters.ChallengeCreated(null, null, null);
    
        const { emitterWitness, eventPromise } = expectEvent(turbo, filter);

        const tx = await turbo.forceMove(
          agreedState.asEthersObject,
          challengeState.asEthersObject,
          signatures,
        );
        await tx.wait();
        await eventPromise;

        expect(await challengeInProgress(channel.id)).toBe(true);

        expect(emitterWitness).toBeCalled();
      });

      it('reverts when the move is not valid', async () => {
        const agreedState = state0;
        const challengeState = state3;

        const { r: r0, s: s0, v: v0 } = sign(agreedState.toHex(), challengee.privateKey);
        const { r: r1, s: s1, v: v1 } = sign(challengeState.toHex(), challenger.privateKey);
        const signatures = [
          { r: r0, s: s0, v: v0 },
          { r: r1, s: s1, v: v1 }
        ];
    
        expect(await turbo.outcomeFinal(channel.id)).toBe(false);
    
        const tx = turbo.forceMove(
          agreedState.asEthersObject,
          challengeState.asEthersObject,
          signatures,
        );
        assertRevert(
          tx,
          "Invalid transition: turnNum must increase by 1"
        );
        await delay();
      });

      it('reverts when the states are not signed', async () => {
        const agreedState = state0;
        const challengeState = state1;

        const { r: r0, s: s0, v: v0 } = sign(agreedState.toHex(), challengee.privateKey);
        const { r: r1, s: s1, v: v1 } = sign(state3.toHex(), challenger.privateKey);
        const signatures = [
          { r: r0, s: s0, v: v0 },
          { r: r1, s: s1, v: v1 }
        ];
    
        expect(await turbo.outcomeFinal(channel.id)).toBe(false);
    
        const tx = turbo.forceMove(
          agreedState.asEthersObject,
          challengeState.asEthersObject,
          signatures,
        );
        assertRevert(
          tx,
          "ForceMove: challengeState not authorized"
        );
        await delay();
      });

      it('reverts when the channel is closed', async () => {
        const agreedState = state0;
        const challengeState = state1;

        const { r: r0, s: s0, v: v0 } = sign(agreedState.toHex(), challengee.privateKey);
        const { r: r1, s: s1, v: v1 } = sign(challengeState.toHex(), challenger.privateKey);
        const signatures = [
          { r: r0, s: s0, v: v0 },
          { r: r1, s: s1, v: v1 }
        ];
    
        const outcome = {
          destination: [alice.address, bob.address],
          amount: resolution,
          finalizedAt: ethers.utils.bigNumberify(1),
          challengeState: state0.asEthersObject,
        };
        await (await turbo.setOutcome(channel.id, outcome)).wait();
        expect(await turbo.outcomeFinal(channel.id)).toBe(true);
    
        const tx = turbo.forceMove(
          agreedState.asEthersObject,
          challengeState.asEthersObject,
          signatures,
        );
        assertRevert(
          tx,
          "ForceMove: channel must be open"
        );
        await delay();
      });
    });
  });
});

function delay(ms = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function challengeInProgress(channelId: string) {
  return 1000*Number((await turbo.outcomes(channelId)).finalizedAt) > Date.now();
}