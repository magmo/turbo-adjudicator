pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "fmg-core/contracts/State.sol";
import "fmg-core/contracts/Rules.sol";
import "fmg-core/contracts/ForceMoveGame.sol";

contract TurboAdjudicator {
    using State for State.StateStruct;

    struct Channel {
        address gameLibrary;
        uint challengeDuration;
    }
}
