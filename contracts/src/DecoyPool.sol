// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CreditPool} from "./CreditPool.sol";

interface IRegistryWrite {
    function register(address model, uint96 fee, int256[10][] calldata inputs, uint16[] calldata scores)
        external
        returns (uint32 id);
}

/// @title  DecoyPool — "a platform that quietly changed its model", set up on demand.
/// @notice A CreditPool that subscribes to the tampered scorecard. arm() registers that model
///         again under the honest reference scores and points this pool at the new id. Anyone can
///         then call registry.audit() on the id: the audit fails, the model is frozen for good and
///         this pool stops lending.
/// @dev    A freeze is permanent, so every rehearsal needs a fresh registration; arm() is the only
///         thing added on top of CreditPool. The real pool has no way to change its model.
contract DecoyPool is CreditPool {
    address public immutable decoy;
    uint256 public round;

    event Armed(uint256 round, uint32 id);

    constructor(address _tusd, address _book, address _registry, address _decoy)
        CreditPool(_tusd, _book, _registry, type(uint32).max)
    {
        decoy = _decoy;
    }

    function arm() external returns (uint32 id) {
        int256[10][] memory ins = new int256[10][](4);
        ins[0] = [int256(0), 1000, 0, 0, 0, 0, 0, 0, 0, 0];
        ins[1] = [int256(0), 1000, 0, 0, 1000, 500, 0, 1000, 0, 500];
        ins[2] = [int256(0), 1000, 1, 1, 1000, 500, 0, 1000, 0, 500];
        ins[3] = [int256(870), 2500, 0, 0, 48, 284, 0, 42, 62, 284];
        uint16[] memory out = new uint16[](4);
        // what the honest scorecard answers for these inputs
        out[0] = 288;
        out[1] = 755;
        out[2] = 618;
        out[3] = 947;
        id = IRegistryWrite(address(registry)).register(decoy, 0, ins, out);
        modelId = id;
        round += 1;
        emit Armed(round, id);
    }

    /// @notice What this pool would answer right now. ok == false means it refuses to lend.
    function status(address user, uint128 collateral)
        external
        view
        returns (uint256 round_, uint32 id, bool usable, bool ok, uint16 score, uint256 limit)
    {
        round_ = round;
        id = modelId;
        usable = registry.isUsable(id);
        try this.quote(user, collateral) returns (uint16 s, uint256 l, uint96) {
            ok = true;
            score = s;
            limit = l;
        } catch {}
    }
}
