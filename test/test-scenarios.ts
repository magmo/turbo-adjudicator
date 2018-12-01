import { ethers, utils } from "ethers";

const aBal = ethers.utils.parseUnits('6', 'wei');
const bBal = ethers.utils.parseUnits('4', 'wei');
const resolution = [aBal, bBal];
const differentResolution = [bBal, aBal];

export const channel = {
    id: "0x" + "1".repeat(40),
};
    