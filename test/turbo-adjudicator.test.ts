import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import SimpleAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import { ethers, ContractFactory, Wallet } from 'ethers';
import { expectEvent, linkedByteCode } from 'magmo-devtools';

jest.setTimeout(20000);
let turbo;

const aBal = ethers.utils.parseUnits('6', 'wei');
const bBal = ethers.utils.parseUnits('4', 'wei');
const resolution = [aBal, bBal];
const differentResolution = [bBal, aBal];

const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
// the following private key is funded with 1 million eth in the startGanache function
const privateKey = '0xf2f48ee19680706196e2e339e5da3491186e0c4c5030670656b0e0164837257d';
const wallet = new Wallet(privateKey, provider);

describe('SimpleAdjudicator', () => {
  beforeEach(async () => {
    const networkId = (await provider.getNetwork()).chainId;

    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, StateArtifact, networkId);
    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, RulesArtifact, networkId);

    turbo = await ContractFactory.fromSolidity(SimpleAdjudicatorArtifact, wallet).deploy();
  });

  it("works", () => {
      expect(turbo).toBeTruthy();
  });
});
