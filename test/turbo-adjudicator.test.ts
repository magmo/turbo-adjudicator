import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import SimpleAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ContractFactory } from 'ethers';
import { linkedByteCode, expectRevert, walletWithEthAndProvider as wallet, getNetworkId  } from 'magmo-devtools';

import { channel, } from "./test-scenarios";

jest.setTimeout(20000);
let turbo;

describe('SimpleAdjudicator', () => {
  beforeEach(async () => {
    const networkId = await getNetworkId();

    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, StateArtifact, networkId);
    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, RulesArtifact, networkId);

    turbo = await ContractFactory.fromSolidity(SimpleAdjudicatorArtifact, wallet).deploy();
  });

  it("handles deposits", async () => {
    await turbo.deposit(channel.id, 20, { value: 20 });
    const allocatedAmount  = await turbo.allocations(channel.id);

    expect(allocatedAmount.toNumber()).toEqual(20);
  });

  it("requires deposit amount to match msg.value", async () => {
    expectRevert(turbo.deposit(channel.id, 20, { value: 10 }), "deposit amount must match msg.value");
  });
});
