// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  AgentCard — an owner issues a credit sub-card to an agent address and funds its deposit.
/// @notice The card is only a binding plus the deposit transfer. Scoring and lending stay in
///         CreditPool; this contract answers "whose agent is this" for everyone else.
contract AgentCard {
    IERC20Min public immutable tusd;

    mapping(address => address) public ownerOf;      // agent => owner
    mapping(address => string) public nameOf;        // agent => display name
    mapping(address => address[]) private _agentsOf; // owner => agents
    address[] public agents;                         // every card ever issued, in order

    event CardIssued(address indexed owner, address indexed agent, string name, uint256 deposit);

    error AlreadyIssued();

    constructor(address _tusd) {
        tusd = IERC20Min(_tusd);
    }

    /// @param deposit tUSD moved from the owner to the agent, to be used as the agent's collateral
    function issue(address agent, string calldata name, uint256 deposit) external {
        if (ownerOf[agent] != address(0)) revert AlreadyIssued();
        ownerOf[agent] = msg.sender;
        nameOf[agent] = name;
        _agentsOf[msg.sender].push(agent);
        agents.push(agent);
        if (deposit > 0) require(tusd.transferFrom(msg.sender, agent, deposit), "DEPOSIT");
        emit CardIssued(msg.sender, agent, name, deposit);
    }

    function agentsOf(address owner) external view returns (address[] memory) {
        return _agentsOf[owner];
    }

    function agentCount() external view returns (uint256) {
        return agents.length;
    }
}
