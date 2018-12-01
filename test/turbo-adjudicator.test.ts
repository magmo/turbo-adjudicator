import StateArtifact from '../build/contracts/State.json';
import RulesArtifact from '../build/contracts/Rules.json';
import CountingStateArtifact from '../build/contracts/CountingState.json';
import CountingGameArtifact from '../build/contracts/CountingGame.json';
import SimpleAdjudicatorArtifact from '../build/contracts/TurboAdjudicator.json';
import linker from 'solc/linker';
import { ethers, ContractFactory, Wallet } from 'ethers';
import { expectEvent } from 'magmo-devtools';

jest.setTimeout(20000);
let turbo;

const aBal = ethers.utils.parseUnits('6', 'wei');
const bBal = ethers.utils.parseUnits('4', 'wei');
const resolution = [aBal, bBal];
const differentResolution = [bBal, aBal];

let networkId;
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
// the following private key is funded with 1 million eth in the startGanache function
const privateKey = '0xf2f48ee19680706196e2e339e5da3491186e0c4c5030670656b0e0164837257d';
const wallet = new Wallet(privateKey, provider);

function linkedByteCode(artifact, linkedLibrary) {
    const lookup = {};
    try {
    lookup[linkedLibrary.contractName] = linkedLibrary.networks[networkId].address;
    } catch (err) {
    // tslint:disable-next-line:no-console
    console.error(linkedLibrary.networks, linkedLibrary.contractName, networkId);
    }
    return linker.linkBytecode(artifact.bytecode, lookup);
}

describe('SimpleAdjudicator', () => {
  beforeEach(async () => {
    networkId = (await provider.getNetwork()).chainId;
    CountingStateArtifact.bytecode = linkedByteCode(CountingStateArtifact, StateArtifact);

    CountingGameArtifact.bytecode = linker.linkBytecode(CountingGameArtifact.bytecode, {
      CountingState: CountingStateArtifact.networks[networkId].address,
    });
    const countingGameContract = await ContractFactory.fromSolidity(
      CountingGameArtifact,
      wallet,
    ).attach(CountingGameArtifact.networks[networkId].address);

    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, StateArtifact);
    SimpleAdjudicatorArtifact.bytecode = linkedByteCode(SimpleAdjudicatorArtifact, RulesArtifact);

    turbo = await ContractFactory.fromSolidity(SimpleAdjudicatorArtifact, wallet).deploy();
  });

  it("works", () => {
      expect(turbo).toBeTruthy();
  });
});
