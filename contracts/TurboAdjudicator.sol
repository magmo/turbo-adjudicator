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

    struct Authorization {
        // *********************************************************
        // WARNING
        // -------
        // This authorization does not prevent collisions.
        // It only prevents griefing: if the participant signs
        // this authorization, we assume they wish to withdraw
        // the amount to the destination. Therefore, any front-
        // runner who submits the transaction in lieu of the
        // participant is simply saving them some gas.
        // (If the amount were not part of the authorization,
        // then a malicious actor could submit a withdrawal
        // for a tiny amount, forcing alice to submit a new
        // signature with an increased nonce. If they have to
        // submit the amount that the participant authorized,
        // then the participant can be satisfied with the front-
        // runner's transaction, which causes the desired transfer.)
        // *********************************************************
        address destination;
        uint amount;
        uint nonce;
    }

    mapping(address => uint) public allocations;
    mapping(address => uint) public withdrawalNonce;

    function deposit(address destination, uint amount) public payable {
        require(
            amount == msg.value,
            "deposit amount must match msg.value"
        );

        allocations[destination] = allocations[destination] + amount;
    }

    function withdraw(address participant, address payable destination, uint amount, bytes32 signedMessage, uint8 _v, bytes32 _r, bytes32 _s) public payable {
        require(
            allocations[participant] >= amount,
            "Withdraw: overdrawn"
        );
        require(
            ecrecover(signedMessage, _v, _r, _s) == participant,
            "Withdraw: not authorized by fromParticipant"
        );


        Authorization memory authorization = Authorization(
            destination,
            amount,
            withdrawalNonce[participant]
        );
        require(
            signedMessage == keccak256(abi.encode(authorization)),
            "Withdraw: invalid authorization"
        );

        withdrawalNonce[participant] = withdrawalNonce[participant] + 1;
        allocations[participant] = allocations[participant] - amount;
        destination.transfer(amount);
    }
}