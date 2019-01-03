pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;
import "fmg-core/contracts/State.sol";
import "fmg-core/contracts/Rules.sol";

contract TurboAdjudicator {
    using State for State.StateStruct;

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
        uint256 finalizedAt;
        State.StateStruct challengeState;
    }
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct ConclusionProof {
        State.StateStruct penultimateState;
        Signature penultimateSignature;
        State.StateStruct ultimateState;
        Signature ultimateSignature;
    }

    mapping(address => uint) public allocations;
    mapping(address => uint) public withdrawalNonce;
    mapping(address => Outcome) public outcomes;

    // TODO: Challenge duration should depend on the channel
    uint constant CHALLENGE_DURATION = 5 minutes;

    // **************
    // Eth Management
    // **************

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
            outcomes[channel].finalizedAt < now,
            "Transfer: outcome must be final"
        );
        require(
            outcomes[channel].finalizedAt > 0,
            "Transfer: outcome must be present"
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
                    outcomes[channel].finalizedAt,
                    outcomes[channel].challengeState // Once the outcome is finalized, 
                );
                outcomes[channel] = updatedOutcome;
                return;
            }
        }

        revert("Transfer: destination not in outcome");
    }

    // ******
    // Events
    // ******

    event ChallengeCreated(
        address channelId,
        State.StateStruct state,
        uint256 finalizedAt
    );
    event Concluded(address channelId);
    event Refuted(address channelId, State.StateStruct refutation);
    event RespondedWithMove(address channelId, State.StateStruct response);

    // **********************
    // ForceMove Protocol API
    // **********************

    function conclude(ConclusionProof memory proof) public {
        _conclude(proof);
    }

    function forceMove(
        State.StateStruct memory agreedState,
        State.StateStruct memory challengeState,
        Signature[] memory signatures
    ) public {
        require(
            !isChannelClosed(agreedState.channelId()),
            "ForceMove: channel must be open"
        );
        require(
            moveAuthorized(agreedState, signatures[0]),
            "ForceMove: agreedState not authorized"
        );
        require(
            moveAuthorized(challengeState, signatures[1]),
            "ForceMove: challengeState not authorized"
        );
        require(
            Rules.validTransition(agreedState, challengeState)
        );

        address channelId = agreedState.channelId();

        outcomes[channelId] = Outcome(
            challengeState.participants,
            challengeState.resolution,
            now + CHALLENGE_DURATION,
            challengeState
        );

        emit ChallengeCreated(
            channelId,
            challengeState,
            now
        );
    }

    function refute(State.StateStruct memory refutationState, Signature memory signature) public {
        address channel = refutationState.channelId();
        require(
            !isChannelClosed(channel),
            "Refute: channel must be open"
        );

        require(
            moveAuthorized(refutationState, signature),
            "Refute: move must be authorized"
        );

        require(
            Rules.validRefute(outcomes[channel].challengeState, refutationState, signature.v, signature.r, signature.s),
            "Refute: must be a valid refute"
        );

        emit Refuted(channel, refutationState);
        Outcome memory updatedOutcome = Outcome(
            outcomes[channel].destination,
            refutationState.resolution,
            0,
            refutationState
        );
        outcomes[channel] = updatedOutcome;
    }

    function respondWithMove(State.StateStruct memory responseState, Signature memory signature) public {
        address channel = responseState.channelId();
        require(
            !isChannelClosed(channel),
            "RespondWithMove: channel must be open"
        );

        require(
            moveAuthorized(responseState, signature),
            "RespondWithMove: move must be authorized"
        );

        require(
            Rules.validRespondWithMove(outcomes[channel].challengeState, responseState, signature.v, signature.r, signature.s),
            "RespondWithMove: must be a valid response"
        );

        emit RespondedWithMove(channel, responseState);

        Outcome memory updatedOutcome = Outcome(
            outcomes[channel].destination,
            responseState.resolution,
            0,
            responseState
        );
        outcomes[channel] = updatedOutcome;
    }

    // ************************
    // ForceMove Protocol Logic
    // ************************

    function _conclude(ConclusionProof memory proof) internal {
        address channelId = proof.penultimateState.channelId();
        require(
            (outcomes[channelId].finalizedAt > now || outcomes[channelId].finalizedAt == 0),
            "Conclude: channel must not be finalized"
        );

        outcomes[channelId] = Outcome(
            proof.penultimateState.participants,
            proof.penultimateState.resolution,
            now,
            proof.penultimateState
        );
        emit Concluded(channelId);
    }

    // ****************
    // Helper functions
    // ****************

    function isChallengeOngoing(address channel) public view returns (bool) {
        return outcomes[channel].finalizedAt > now;
    }

    function isChannelClosed(address channel) public view returns (bool) {
        return outcomes[channel].finalizedAt < now && outcomes[channel].finalizedAt > 0;
    }

    function outcomesEqual(Outcome memory a, Outcome memory b) internal pure returns (bool) {
        return equals(abi.encode(a), abi.encode(b));
    }

    function equals(bytes memory a, bytes memory b) internal pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }

    function moveAuthorized(State.StateStruct memory _state, Signature memory signature) public pure returns (bool){
        return _state.mover() == recoverSigner(
            abi.encode(_state),
            signature.v,
            signature.r,
            signature.s
        );
    }

    function recoverSigner(bytes memory _d, uint8 _v, bytes32 _r, bytes32 _s) public pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_d);

        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, h));

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }

    // *********************************
    // Helper functions -- TO BE REMOVED
    // *********************************

    function channelId(State.StateStruct memory state) public pure returns (address) {
        return state.channelId();
    }

    function outcomeFinal(address channel) public view returns (bool) {
        return outcomes[channel].finalizedAt > 0 && outcomes[channel].finalizedAt < now;
    }

    function setOutcome(address channel, Outcome memory outcome) public {
        // Temporary helper function to set outcomes for testing

        require(
            outcome.destination.length == outcome.amount.length,
            "destination.length must be equal to amount.length"
        );

        outcomes[channel] = outcome;
    }

    function getOutcome(address channel) public view returns (Outcome memory) {
        return outcomes[channel];
    }

}