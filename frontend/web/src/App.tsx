import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VotingProposal {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  publicShares: number;
  endTime: number;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
  totalVotes?: number;
}

interface VoteStats {
  totalProposals: number;
  activeVotes: number;
  avgParticipation: number;
  verifiedCount: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<VotingProposal[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", shares: "" });
  const [selectedProposal, setSelectedProposal] = useState<VotingProposal | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [voteHistory, setVoteHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<VoteStats>({ totalProposals: 0, activeVotes: 0, avgParticipation: 0, verifiedCount: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for corporate voting...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadProposals();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadProposals = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const proposalsList: VotingProposal[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          proposalsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedVotes: businessId,
            publicShares: Number(businessData.publicValue1) || 0,
            endTime: Number(businessData.timestamp) + 604800,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            totalVotes: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading proposal data:', e);
        }
      }
      
      setProposals(proposalsList);
      updateStats(proposalsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load proposals" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (proposalsList: VotingProposal[]) => {
    const totalProposals = proposalsList.length;
    const activeVotes = proposalsList.filter(p => p.endTime > Date.now()/1000).length;
    const verifiedCount = proposalsList.filter(p => p.isVerified).length;
    const avgParticipation = totalProposals > 0 ? proposalsList.reduce((sum, p) => sum + (p.totalVotes || 0), 0) / totalProposals : 0;
    
    setStats({ totalProposals, activeVotes, avgParticipation, verifiedCount });
  };

  const createProposal = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProposal(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted voting proposal..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const sharesValue = parseInt(newProposalData.shares) || 1000;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sharesValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        sharesValue,
        0,
        newProposalData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Voting proposal created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadProposals();
      setShowCreateModal(false);
      setNewProposalData({ title: "", description: "", shares: "" });
      
      setVoteHistory(prev => [{
        action: "Created Proposal",
        title: newProposalData.title,
        timestamp: Date.now(),
        shares: sharesValue
      }, ...prev]);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProposal(false); 
    }
  };

  const castVote = async (proposalId: string, voteValue: number) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting your vote..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      const businessId = `vote-${proposalId}-${Date.now()}`;
      
      const tx = await contract.createBusinessData(
        businessId,
        "Vote Cast",
        encryptedResult.encryptedData,
        encryptedResult.proof,
        voteValue,
        1,
        `Vote for proposal ${proposalId}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Recording encrypted vote..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote cast successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadProposals();
      
      setVoteHistory(prev => [{
        action: "Cast Vote",
        proposalId: proposalId,
        vote: voteValue,
        timestamp: Date.now()
      }, ...prev]);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Vote failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptResults = async (proposalId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Decrypting voting results..." });
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(proposalId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Results already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(proposalId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(proposalId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadProposals();
      
      setTransactionStatus({ visible: true, status: "success", message: "Results decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Results are already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadProposals();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System is available and ready!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Total Proposals</h3>
          <div className="stat-value">{stats.totalProposals}</div>
          <div className="stat-trend">+{stats.activeVotes} active</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Results</h3>
          <div className="stat-value">{stats.verifiedCount}/{stats.totalProposals}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Participation</h3>
          <div className="stat-value">{stats.avgParticipation.toFixed(1)}</div>
          <div className="stat-trend">Votes per proposal</div>
        </div>
      </div>
    );
  };

  const renderVoteChart = (proposal: VotingProposal) => {
    const yesVotes = proposal.isVerified ? (proposal.decryptedValue || 0) : 65;
    const noVotes = 100 - yesVotes;
    
    return (
      <div className="vote-chart">
        <div className="chart-title">Vote Distribution</div>
        <div className="chart-bars">
          <div className="bar-container">
            <div className="bar-label">Approve</div>
            <div className="bar">
              <div 
                className="bar-fill yes" 
                style={{ width: `${yesVotes}%` }}
              >
                <span className="bar-value">{yesVotes}%</span>
              </div>
            </div>
          </div>
          <div className="bar-container">
            <div className="bar-label">Reject</div>
            <div className="bar">
              <div 
                className="bar-fill no" 
                style={{ width: `${noVotes}%` }}
              >
                <span className="bar-value">{noVotes}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CorpVoteZama 🔐</h1>
            <span>Confidential Corporate Voting</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🗳️</div>
            <h2>Connect Your Wallet to Access Secure Voting</h2>
            <p>Please connect your wallet to initialize the encrypted voting system and participate in corporate governance.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and participating in encrypted votes</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Voting System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CorpVoteZama 🔐</h1>
          <span>Enterprise Confidential Voting</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Proposal
          </button>
          <button 
            onClick={testAvailability} 
            className="test-btn metal-btn"
          >
            Test FHE
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Corporate Voting Dashboard</h2>
          {renderStatsDashboard()}
          
          <div className="panel metal-panel full-width">
            <h3>FHE Voting Process</h3>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <div className="step-content">
                  <h4>Encrypted Voting</h4>
                  <p>Votes encrypted with Zama FHE technology</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <div className="step-content">
                  <h4>Secure Storage</h4>
                  <p>Encrypted votes stored on blockchain</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <div className="step-content">
                  <h4>Homomorphic Tally</h4>
                  <p>Votes counted without decryption</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">4</div>
                <div className="step-content">
                  <h4>Verified Results</h4>
                  <p>Final results verified on-chain</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="proposals-section">
          <div className="section-header">
            <h2>Active Voting Proposals</h2>
            <div className="header-actions">
              <button 
                onClick={loadProposals} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="proposals-list">
            {proposals.length === 0 ? (
              <div className="no-proposals">
                <p>No voting proposals found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Proposal
                </button>
              </div>
            ) : proposals.map((proposal, index) => (
              <div 
                className={`proposal-item metal-panel ${selectedProposal?.id === proposal.id ? "selected" : ""} ${proposal.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedProposal(proposal)}
              >
                <div className="proposal-title">{proposal.title}</div>
                <div className="proposal-description">{proposal.description}</div>
                <div className="proposal-meta">
                  <span>Shares: {proposal.publicShares}</span>
                  <span>Ends: {new Date(proposal.endTime * 1000).toLocaleDateString()}</span>
                </div>
                <div className="proposal-status">
                  Status: {proposal.isVerified ? "✅ Results Verified" : "🔓 Voting Active"}
                  {proposal.isVerified && proposal.decryptedValue && (
                    <span className="verified-result">Result: {proposal.decryptedValue}% Yes</span>
                  )}
                </div>
                <div className="proposal-actions">
                  <button 
                    onClick={(e) => { e.stopPropagation(); castVote(proposal.id, 1); }} 
                    className="vote-btn metal-btn"
                  >
                    Vote Yes
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); castVote(proposal.id, 0); }} 
                    className="vote-btn metal-btn"
                  >
                    Vote No
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="history-section">
          <h3>Voting History</h3>
          <div className="history-list">
            {voteHistory.slice(0, 5).map((record, index) => (
              <div key={index} className="history-item metal-panel">
                <div className="history-action">{record.action}</div>
                <div className="history-details">
                  {record.title && <span>{record.title}</span>}
                  {record.vote !== undefined && <span>Vote: {record.vote === 1 ? 'Yes' : 'No'}</span>}
                </div>
                <div className="history-time">{new Date(record.timestamp).toLocaleString()}</div>
              </div>
            ))}
            {voteHistory.length === 0 && (
              <div className="no-history">No voting history yet</div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateProposal 
          onSubmit={createProposal} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingProposal} 
          proposalData={newProposalData} 
          setProposalData={setNewProposalData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => setSelectedProposal(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptResults={() => decryptResults(selectedProposal.id)}
          renderVoteChart={renderVoteChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateProposal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, proposalData, setProposalData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'shares') {
      const intValue = value.replace(/[^\d]/g, '');
      setProposalData({ ...proposalData, [name]: intValue });
    } else {
      setProposalData({ ...proposalData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-proposal-modal metal-panel">
        <div className="modal-header">
          <h2>New Voting Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Vote counts will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Proposal Title *</label>
            <input 
              type="text" 
              name="title" 
              value={proposalData.title} 
              onChange={handleChange} 
              placeholder="Enter proposal title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={proposalData.description} 
              onChange={handleChange} 
              placeholder="Describe the voting proposal..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Total Shares (Integer) *</label>
            <input 
              type="number" 
              name="shares" 
              value={proposalData.shares} 
              onChange={handleChange} 
              placeholder="Enter total shares..." 
              step="1"
              min="1"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !proposalData.title || !proposalData.description || !proposalData.shares} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProposalDetailModal: React.FC<{
  proposal: VotingProposal;
  onClose: () => void;
  isDecrypting: boolean;
  decryptResults: () => Promise<number | null>;
  renderVoteChart: (proposal: VotingProposal) => JSX.Element;
}> = ({ proposal, onClose, isDecrypting, decryptResults, renderVoteChart }) => {
  const handleDecrypt = async () => {
    await decryptResults();
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal metal-panel">
        <div className="modal-header">
          <h2>Voting Proposal Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-info">
            <div className="info-item">
              <span>Proposal Title:</span>
              <strong>{proposal.title}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{proposal.creator.substring(0, 6)}...{proposal.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Voting Ends:</span>
              <strong>{new Date(proposal.endTime * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Total Shares:</span>
              <strong>{proposal.publicShares}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{proposal.description}</p>
          </div>
          
          <div className="data-section">
            <h3>Voting Results</h3>
            
            <div className="data-row">
              <div className="data-label">Current Status:</div>
              <div className="data-value">
                {proposal.isVerified ? 
                  `Verified: ${proposal.decryptedValue}% Approval` : 
                  "🔒 Encrypted - Results Hidden"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${proposal.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : proposal.isVerified ? (
                  "✅ Verified"
                ) : (
                  "🔓 Decrypt Results"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Confidential Voting</strong>
                <p>Votes are encrypted using homomorphic encryption. Results can only be decrypted with proper authorization.</p>
              </div>
            </div>
          </div>
          
          {(proposal.isVerified) && (
            <div className="results-section">
              <h3>Voting Results Analysis</h3>
              {renderVoteChart(proposal)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!proposal.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "Decrypting..." : "Decrypt Results"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

