pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract TurboAdjudicator {
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

    struct Outcome {
        address[] destination;
        uint[] amount;
        bool isFinal;
    }

    mapping(address => uint) public allocations;
    mapping(address => uint) public withdrawalNonce;
    mapping(address => Outcome) public outcomes;

    function deposit(address destination) public payable {
        allocations[destination] = allocations[destination] + msg.value;
    }

    function withdraw(address participant, address payable destination, uint amount, bytes memory encodedAuthorization, uint8 _v, bytes32 _r, bytes32 _s) public payable {
        require(
            allocations[participant] >= amount,
            "Withdraw: overdrawn"
        );
        require(
            recoverSigner(encodedAuthorization, _v, _r, _s) == participant,
            "Withdraw: not authorized by fromParticipant"
        );

        Authorization memory authorization = Authorization(
            destination,
            amount,
            withdrawalNonce[participant]
        );
        require(
            keccak256(encodedAuthorization) == keccak256(abi.encode(authorization)),
            "Withdraw: invalid authorization"
        );

        withdrawalNonce[participant] = withdrawalNonce[participant] + 1;
        allocations[participant] = allocations[participant] - amount;
        destination.transfer(amount);
    }

    function transfer(address channel, address destination, uint amount) public {
        require(
            outcomes[channel].isFinal,
            "Transfer: outcome must be final"
        );

        uint256 pending = 0;
        for (uint256 i = 0; i < outcomes[channel].destination.length; i++) {
            pending = pending + outcomes[channel].amount[i];

            if (outcomes[channel].destination[i] == destination) {
                require(
                    pending <= allocations[channel],
                    "Transfer: allocations[channel] must cover transfer"
                );

                require(
                    amount <= outcomes[channel].amount[i],
                    "Transfer: transfer too large"
                );

                allocations[destination] = allocations[destination] + amount;
                allocations[channel] = allocations[channel] - amount;

                uint256[] memory updatedAmounts = outcomes[channel].amount;
                updatedAmounts[i] = updatedAmounts[i] - amount;

                Outcome memory updatedOutcome = Outcome(
                    outcomes[channel].destination,
                    updatedAmounts,
                    outcomes[channel].isFinal
                );
                outcomes[channel] = updatedOutcome;
                return;
            }
        }

        revert("Transfer: destination not in outcome");
    }

    // Helper functions
    function setOutcome(address channel, Outcome memory outcome) public {
        // Temporary helper function to set outcomes for testing
        // Will eventually be internal
        require(
            channel != address(this),
            "Invalid channel"
        );

        if (!outcomesEqual(outcomes[channel], outcomes[address(this)])) {
            require(
                equals(abi.encode(outcome.destination), abi.encode(outcomes[channel].destination)),
                "destination must match existing outcome"
            );
        }

        require(
            outcome.destination.length == outcome.amount.length,
            "destination.length must be equal to amount.length"
        );

        outcomes[channel] = outcome;
    }

    function getOutcome(address channel) public view returns (Outcome memory) {
        return outcomes[channel];
    }

    function outcomesEqual(Outcome memory a, Outcome memory b) internal pure returns (bool) {
        return equals(abi.encode(a), abi.encode(b));
    }

    function equals(bytes memory a, bytes memory b) internal pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }


    function recoverSigner(bytes memory _d, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_d);

        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, h));

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }
}