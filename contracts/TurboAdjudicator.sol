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

    mapping(address => uint) public allocations;

    function deposit(address destination, uint amount) public payable {
        require(
            amount == msg.value,
            "deposit amount must match msg.value"
        );

        allocations[destination] = allocations[destination] + amount;
    }
}
