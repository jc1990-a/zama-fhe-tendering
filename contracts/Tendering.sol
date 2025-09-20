// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Tender / Bidding Contract (amount stored in ETH)
/// @notice Users create bidding projects, accept bids (payable), and winner is revealed on termination.
contract Tendering {
    struct Project {
        address creator;
        string title;
        string description;
        uint256 deadline;
        bool terminated;
        address winner;
        bool winnerDeclared;
        uint256 lowestBid;   // in ETH
        uint256 highestBid;  // in ETH
        uint256 sumBids;     // sum of all bids (ETH)
        uint256 numBids;
        uint256 lowestValidBidIndex;
    }

    struct Bid {
        address bidder;
        uint256 amount; // in ETH
        bool exists;
    }

    mapping(uint256 => Project) public projects;
    mapping(uint256 => Bid[]) public projectBids;

    uint256 public nextProjectId;

    event ProjectCreated(uint256 indexed projectId, address indexed creator, uint256 deadline);
    event BidPlaced(uint256 indexed projectId, address indexed bidder, uint256 amountETH);
    event ProjectTerminated(uint256 indexed projectId, address indexed terminator);
    event WinnerDeclared(uint256 indexed projectId, address indexed winner, uint256 lowestBidETH);

    /// @notice Create a new project
    function createProject(
        string calldata _title,
        string calldata _description,
        uint256 _deadline
    ) external returns (uint256 projectId) {
        require(_deadline > block.timestamp, "Deadline must be in the future");

        projectId = nextProjectId;
        Project storage p = projects[projectId];
        p.creator = msg.sender;
        p.title = _title;
        p.description = _description;
        p.deadline = _deadline;
        p.lowestBid = type(uint256).max;
        p.highestBid = 0;
        p.sumBids = 0;
        p.numBids = 0;
        p.lowestValidBidIndex = 0;

        nextProjectId++;
        emit ProjectCreated(projectId, msg.sender, _deadline);
    }

    /// @notice Place a bid (value in ETH)
    function placeBid(uint256 projectId, uint256 amountETH) external {
        Project storage p = projects[projectId];
        require(!p.terminated, "Project terminated");
        require(block.timestamp < p.deadline, "Deadline passed");
        require(amountETH > 0, "Bid must >0");

        projectBids[projectId].push(Bid({
            bidder: msg.sender,
            amount: amountETH,
            exists: true
        }));

        p.numBids++;
        p.sumBids += amountETH;
        if (amountETH < p.lowestBid) {
            p.lowestBid = amountETH;
            p.lowestValidBidIndex = projectBids[projectId].length - 1;
        }
        if (amountETH > p.highestBid) {
            p.highestBid = amountETH;
        }

        emit BidPlaced(projectId, msg.sender, amountETH);
    }


    /// @notice Terminate project & automatically declare winner
    function terminateProject(uint256 projectId) external {
        Project storage p = projects[projectId];
        require(msg.sender == p.creator, "Only creator");
        require(!p.terminated, "Already terminated");

        p.terminated = true;
        emit ProjectTerminated(projectId, msg.sender);

        if (p.numBids == 0) {
            p.winner = address(0);
            p.lowestBid = 0;
        } else {
            Bid memory b = projectBids[projectId][p.lowestValidBidIndex];
            p.winner = b.bidder;
        }
        p.winnerDeclared = true;
        emit WinnerDeclared(projectId, p.winner, p.lowestBid);
    }

    /// @notice Get project statistics
    function getProjectStats(uint256 projectId)
        external
        view
        returns (uint256 numParticipants, uint256 averageBidETH, uint256 highestBidETH, uint256 lowestBidETH)
    {
        Project storage p = projects[projectId];
        numParticipants = p.numBids;

        if (p.numBids == 0) {
            return (0, 0, 0, 0);
        }
        averageBidETH = p.sumBids / p.numBids;
        highestBidETH = p.highestBid;
        lowestBidETH = p.lowestBid;
    }

    /// @notice View winner and amount (in ETH)
    function getWinner(uint256 projectId)
        external
        view
        returns (address winnerAddress, uint256 lowestBidETH)
    {
        Project storage p = projects[projectId];
        require(p.winnerDeclared, "Winner not declared");
        return (p.winner, p.lowestBid);
    }
}
