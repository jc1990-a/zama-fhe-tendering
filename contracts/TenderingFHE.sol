// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FHETendering
 * @notice Tender / bidding contract using Zama FHEVM encrypted values (euint32).
 *         - Anyone can create a tender project (title, description, deadline).
 *         - Others place bids (encrypted as euint32).
 *         - After deadline or manual termination, anyone can trigger decryption.
 *         - Callback receives plaintext bids, computes winner (lowest bid),
 *           plus stats (min / max / average) and stores them.
 */

import { FHE, euint32, externalEuint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHETendering is SepoliaConfig {
    // ------------------------------------------------------------------------
    // Data structures
    // ------------------------------------------------------------------------

    struct Project {
        address creator;
        string title;
        string description;
        uint256 deadline;
        bool terminated;

        // state of results
        bool decryptionPending;
        bool winnerDeclared;

        // ciphertext stats
        euint32 lowestBidEncrypted;
        euint32 highestBidEncrypted;
        euint32 sumBidsEncrypted;

        // plaintext stats (filled in callback)
        uint32 lowestBidPlain;
        uint32 highestBidPlain;
        uint32 averageBidPlain;

        // participants info
        uint256 numBids;
        address winner;
    }

    struct EncryptedBid {
        address bidder;
        euint32 amount; // encrypted bid amount
    }

    // ------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------

    uint256 public nextProjectId;
    mapping(uint256 => Project) public projects;
    mapping(uint256 => EncryptedBid[]) public projectBids;

    // requestId -> projectId+1  (avoid 0 ambiguity)
    mapping(uint256 => uint256) private requestToProjectPlusOne;

    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------

    event ProjectCreated(uint256 indexed projectId, address indexed creator, uint256 deadline);
    event EncryptedBidPlaced(uint256 indexed projectId, address indexed bidder);
    event ProjectTerminated(uint256 indexed projectId, address indexed terminator);
    event WinnerDeclared(
        uint256 indexed projectId,
        address winner,
        uint32 lowestBidPlain,
        uint32 highestBidPlain,
        uint32 averageBidPlain,
        uint256 numParticipants
    );

    // ------------------------------------------------------------------------
    // Project creation / bidding
    // ------------------------------------------------------------------------

    /// @notice Create a new tender project
    function createProject(
        string calldata _title,
        string calldata _description,
        uint256 _deadline
    ) external returns (uint256 projectId) {
        require(_deadline > block.timestamp, "Deadline must be future");

        projectId = nextProjectId;
        nextProjectId++;

        Project storage p = projects[projectId];
        p.creator = msg.sender;
        p.title = _title;
        p.description = _description;
        p.deadline = _deadline;

        // initialise encrypted stats
        p.sumBidsEncrypted = FHE.asEuint32(0);
        p.lowestBidEncrypted = FHE.asEuint32(type(uint32).max);
        p.highestBidEncrypted = FHE.asEuint32(0);

        emit ProjectCreated(projectId, msg.sender, _deadline);
    }

    /// @notice Submit an encrypted bid
    function placeEncryptedBid(
        uint256 projectId,
        externalEuint32 encInput,
        bytes calldata inputProof
    ) external {
        Project storage p = projects[projectId];
        require(!p.terminated, "Terminated");
        require(block.timestamp < p.deadline, "Deadline passed");
        require(!p.winnerDeclared, "Winner declared");

        // convert external to internal encrypted handle
        euint32 encBid = FHE.fromExternal(encInput, inputProof);

        projectBids[projectId].push(EncryptedBid(msg.sender, encBid));
        p.numBids++;

        // update encrypted sum / min / max
        p.sumBidsEncrypted = FHE.add(p.sumBidsEncrypted, encBid);

        ebool lower = FHE.lt(encBid, p.lowestBidEncrypted);
        p.lowestBidEncrypted = FHE.select(lower, encBid, p.lowestBidEncrypted);

        ebool higher = FHE.gt(encBid, p.highestBidEncrypted);
        p.highestBidEncrypted = FHE.select(higher, encBid, p.highestBidEncrypted);

        FHE.allowThis(p.sumBidsEncrypted);
        FHE.allowThis(p.lowestBidEncrypted);
        FHE.allowThis(p.highestBidEncrypted);

        emit EncryptedBidPlaced(projectId, msg.sender);
    }

    /// @notice Manually terminate a project (before deadline)
    function terminateProject(uint256 projectId) external {
        Project storage p = projects[projectId];
        require(msg.sender == p.creator, "Only creator");
        require(!p.terminated, "Already terminated");
        require(!p.winnerDeclared, "Winner declared");
        p.terminated = true;
        emit ProjectTerminated(projectId, msg.sender);
    }

    // ------------------------------------------------------------------------
    // Winner declaration (async decryption)
    // ------------------------------------------------------------------------

    /// @notice Trigger decryption of all bids to compute winner & stats
    function declareWinner(uint256 projectId) external {
        Project storage p = projects[projectId];
        require(!p.winnerDeclared, "Already declared");
        require(p.terminated || block.timestamp >= p.deadline, "Not finished");
        require(!p.decryptionPending, "Decryption running");

        uint256 n = projectBids[projectId].length;

        if (n == 0) {
            // no bids, just mark empty result
            p.winnerDeclared = true;
            emit WinnerDeclared(projectId, address(0), 0, 0, 0, 0);
            return;
        }

        bytes32[] memory ciphers = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            ciphers[i] = FHE.toBytes32(projectBids[projectId][i].amount);
        }

        uint256 reqId = FHE.requestDecryption(ciphers, this.callbackDeclareWinner.selector);
        requestToProjectPlusOne[reqId] = projectId + 1;
        p.decryptionPending = true;
    }

    /// @notice Callback executed by FHE relayer once plaintext bids are available
    function callbackDeclareWinner(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 stored = requestToProjectPlusOne[requestId];
        require(stored != 0, "Unknown request");
        uint256 projectId = stored - 1;
        Project storage p = projects[projectId];
        require(p.decryptionPending, "No pending");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory bids = abi.decode(cleartexts, (uint32[]));
        uint256 n = bids.length;

        uint32 minVal = type(uint32).max;
        uint32 maxVal = 0;
        uint32 sum = 0;
        uint256 minIndex = 0;

        for (uint256 i = 0; i < n; i++) {
            uint32 v = bids[i];
            sum += v;
            if (v < minVal) {
                minVal = v;
                minIndex = i;
            }
            if (v > maxVal) maxVal = v;
        }
        uint32 avg = n > 0 ? sum / uint32(n) : 0;

        // store results
        p.lowestBidPlain = minVal;
        p.highestBidPlain = maxVal;
        p.averageBidPlain = avg;
        p.winner = projectBids[projectId][minIndex].bidder;

        p.winnerDeclared = true;
        p.decryptionPending = false;
        delete requestToProjectPlusOne[requestId];

        emit WinnerDeclared(projectId, p.winner, minVal, maxVal, avg, n);
    }

    // ------------------------------------------------------------------------
    // Getters for plaintext stats
    // ------------------------------------------------------------------------

    /// @notice Get final stats after winner declared
    function getPlainStats(uint256 projectId)
        external
        view
        returns (
            uint256 numParticipants,
            uint32 averageBid,
            uint32 highestBid,
            uint32 lowestBid,
            address winnerAddr
        )
    {
        Project storage p = projects[projectId];
        require(p.winnerDeclared, "Not ready");
        return (
            p.numBids,
            p.averageBidPlain,
            p.highestBidPlain,
            p.lowestBidPlain,
            p.winner
        );
    }
}
