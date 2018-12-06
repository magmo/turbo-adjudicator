import { ethers } from "ethers";
import { Channel } from "fmg-core";

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