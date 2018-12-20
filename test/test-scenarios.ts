import { ethers } from "ethers";
import { Channel, State, CountingGame, sign } from "fmg-core";

import BN from "bn.js";

const aBal = ethers.utils.parseUnits('6', 'wei');
const bBal = ethers.utils.parseUnits('4', 'wei');
export const resolution = [aBal, bBal];
export const differentResolution = [bBal, aBal];

// alice and bob are both funded by startGanache in magmo devtools.
export const alice = new ethers.Wallet("0x5d862464fe9303452126c8bc94274b8c5f9874cbd219789b3eb2128075a76f72");
export const bob = new ethers.Wallet("0xdf02719c4df8b9b8ac7f551fcb5d9ef48fa27eef7a66453879f4d8fdc6e78fb1");
export const aliceDest = ethers.Wallet.createRandom();

export const channel = new Channel(
    ethers.Wallet.createRandom().address,
    0,
    [alice.address, bob.address]
);

const defaults = { channel, resolution, gameCounter: 0 };

export const state0 = CountingGame.gameState({
    ...defaults,
    gameCounter: 1,
    turnNum: 6,
});
export const state1 = CountingGame.gameState({
    channel,
    resolution,
    turnNum: 7,
    gameCounter: 2,
});
export const state2 = CountingGame.gameState({
    channel,
    resolution,
    turnNum: 8,
    gameCounter: 3,
});
export const state3 = CountingGame.gameState({
    channel,
    resolution,
    turnNum: 9,
    gameCounter: 4,
});
export const state4 = CountingGame.concludeState({
    channel,
    resolution,
    turnNum: 8,
});
export const state5 = CountingGame.concludeState({
    channel,
    resolution,
    turnNum: 9,
});

export const state1alt = CountingGame.gameState({
    channel,
    resolution: differentResolution,
    turnNum: 7,
    gameCounter: 2,
});
export const state2alt = CountingGame.gameState({
    channel,
    resolution: differentResolution,
    turnNum: 8,
    gameCounter: 3,
});



export function conclusionProof(conclusionResolution?: BN[]) {
    //
    const aliceState = state4;
    const bobState = state5;
    if (conclusionResolution) {
        aliceState.resolution = conclusionResolution;
        bobState.resolution = conclusionResolution;
    }
    const { r: r0, s: s0, v: v0 } = sign(aliceState.toHex(), alice.privateKey);
    const { r: r1, s: s1, v: v1 } = sign(bobState.toHex(), bob.privateKey); 

    return {
        penultimateState: aliceState.asEthersObject,
        ultimateState: bobState.asEthersObject,
        penultimateSignature: { v: v0, r: r0, s: s0 },
        ultimateSignature: { v: v1, r: r1, s: s1 },
    };
}