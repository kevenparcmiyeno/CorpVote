pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CorpVoteZama is ZamaEthereumConfig {
    struct Proposal {
        string proposalId;
        string description;
        uint256 endTime;
        bool isActive;
        bool isTallied;
    }

    struct EncryptedVote {
        euint32 encryptedShares;
        euint32 encryptedChoice;
    }

    struct Voter {
        address voterAddress;
        uint256 shareCount;
        bool hasVoted;
    }

    mapping(string => Proposal) public proposals;
    mapping(string => mapping(address => EncryptedVote)) public encryptedVotes;
    mapping(string => Voter) public voters;
    mapping(string => euint32) public encryptedTotalShares;
    mapping(string => euint32) public encryptedVoteCounts;

    string[] public proposalIds;
    address[] public voterAddresses;

    event ProposalCreated(string proposalId, address creator);
    event VoteCast(string proposalId, address voter);
    event ProposalTallied(string proposalId, uint32 totalShares, uint32[] voteCounts);

    constructor() ZamaEthereumConfig() {}

    function createProposal(
        string calldata proposalId,
        string calldata description,
        uint256 duration,
        bytes calldata inputProof
    ) external {
        require(bytes(proposals[proposalId].proposalId).length == 0, "Proposal already exists");
        require(duration > 0, "Duration must be positive");

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            description: description,
            endTime: block.timestamp + duration,
            isActive: true,
            isTallied: false
        });

        encryptedTotalShares[proposalId] = FHE.fromExternal(externalEuint32(0), inputProof);
        encryptedVoteCounts[proposalId] = FHE.fromExternal(externalEuint32(0), inputProof);

        FHE.allowThis(encryptedTotalShares[proposalId]);
        FHE.allowThis(encryptedVoteCounts[proposalId]);

        FHE.makePubliclyDecryptable(encryptedTotalShares[proposalId]);
        FHE.makePubliclyDecryptable(encryptedVoteCounts[proposalId]);

        proposalIds.push(proposalId);
        emit ProposalCreated(proposalId, msg.sender);
    }

    function registerVoter(
        string calldata proposalId,
        address voterAddress,
        uint256 shareCount,
        externalEuint32 encryptedShares,
        bytes calldata inputProof
    ) external {
        require(proposals[proposalId].isActive, "Proposal is not active");
        require(block.timestamp < proposals[proposalId].endTime, "Proposal has ended");
        require(voters[proposalId].voterAddress == address(0), "Voter already registered");

        require(FHE.isInitialized(FHE.fromExternal(encryptedShares, inputProof)), "Invalid encrypted shares");

        voters[proposalId] = Voter({
            voterAddress: voterAddress,
            shareCount: shareCount,
            hasVoted: false
        });

        encryptedTotalShares[proposalId] = FHE.add(
            encryptedTotalShares[proposalId],
            FHE.fromExternal(encryptedShares, inputProof)
        );

        voterAddresses.push(voterAddress);
    }

    function castVote(
        string calldata proposalId,
        externalEuint32 encryptedChoice,
        bytes calldata inputProof
    ) external {
        require(proposals[proposalId].isActive, "Proposal is not active");
        require(block.timestamp < proposals[proposalId].endTime, "Proposal has ended");
        require(!voters[proposalId].hasVoted, "Voter has already voted");

        require(FHE.isInitialized(FHE.fromExternal(encryptedChoice, inputProof)), "Invalid encrypted choice");

        encryptedVotes[proposalId][msg.sender] = EncryptedVote({
            encryptedShares: FHE.fromExternal(encryptedShares, inputProof),
            encryptedChoice: FHE.fromExternal(encryptedChoice, inputProof)
        });

        encryptedVoteCounts[proposalId] = FHE.add(
            encryptedVoteCounts[proposalId],
            FHE.fromExternal(encryptedChoice, inputProof)
        );

        voters[proposalId].hasVoted = true;
        emit VoteCast(proposalId, msg.sender);
    }

    function tallyVotes(string calldata proposalId, bytes memory decryptionProof) external {
        require(proposals[proposalId].isActive, "Proposal is not active");
        require(block.timestamp >= proposals[proposalId].endTime, "Proposal has not ended");
        require(!proposals[proposalId].isTallied, "Proposal already tallied");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(encryptedTotalShares[proposalId]);
        cts[1] = FHE.toBytes32(encryptedVoteCounts[proposalId]);

        bytes memory abiEncodedClearValues = abi.encode(
            FHE.decrypt(encryptedTotalShares[proposalId]),
            FHE.decrypt(encryptedVoteCounts[proposalId])
        );

        FHE.checkSignatures(cts, abiEncodedClearValues, decryptionProof);

        (uint32 totalShares, uint32 voteCount) = abi.decode(abiEncodedClearValues, (uint32, uint32));

        proposals[proposalId].isActive = false;
        proposals[proposalId].isTallied = true;

        emit ProposalTallied(proposalId, totalShares, new uint32[](1));
    }

    function getEncryptedTotalShares(string calldata proposalId) external view returns (euint32) {
        require(proposals[proposalId].isActive, "Proposal does not exist");
        return encryptedTotalShares[proposalId];
    }

    function getEncryptedVoteCounts(string calldata proposalId) external view returns (euint32) {
        require(proposals[proposalId].isActive, "Proposal does not exist");
        return encryptedVoteCounts[proposalId];
    }

    function getProposal(string calldata proposalId) external view returns (
        string memory,
        string memory,
        uint256,
        bool,
        bool
    ) {
        require(proposals[proposalId].isActive, "Proposal does not exist");
        Proposal storage p = proposals[proposalId];
        return (p.proposalId, p.description, p.endTime, p.isActive, p.isTallied);
    }

    function getAllProposalIds() external view returns (string[] memory) {
        return proposalIds;
    }

    function getVoter(string calldata proposalId, address voterAddress) external view returns (
        address,
        uint256,
        bool
    ) {
        require(proposals[proposalId].isActive, "Proposal does not exist");
        Voter storage v = voters[proposalId];
        return (v.voterAddress, v.shareCount, v.hasVoted);
    }

    function getAllVoters() external view returns (address[] memory) {
        return voterAddresses;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

