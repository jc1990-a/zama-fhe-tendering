// App.tsx
import React, { useEffect, useState } from "react";
import { getContractReadOnly, normAddr, ABI, config } from "./contract";
import { FaClock, FaTrophy, FaMoneyBillWave, FaChartLine, FaList, FaPlus, FaLock, FaLockOpen, FaEye, FaEyeSlash } from "react-icons/fa";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import { ethers } from "ethers";

export default function App() {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [biddingProjectId, setBiddingProjectId] = useState<number | null>(null);
  const [biddingAmount, setBiddingAmount] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  interface Project {
    id: number;
    creator: string;
    title: string;
    description: string;
    deadline: number;
    terminated: boolean;
    winnerDeclared: boolean;
    winner: string;
    lowestBid: number;
    highestBid: number;
    numBids: number;
    averageBid: number;
  }

  useEffect(() => {
    loadProjects().finally(() => setLoading(false));
  }, []);

  const checkIsCreator = (addr: string, projectCreator: string) => {
    return normAddr(addr) === normAddr(projectCreator);
  };

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      console.error("Failed to connect wallet", e);
      alert("Failed to connect wallet: " + e);
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // ----------------- Load Projects -----------------
  const loadProjects = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const nextId = Number(await contract.nextProjectId());
      const list: Project[] = [];
      
      for (let i = 0; i < nextId; i++) {
        try {
          const pRaw = await contract.projects(i);
          const stats = await contract.getProjectStats(i);
          
          list.push({
            id: i,
            creator: pRaw.creator,
            title: pRaw.title,
            description: pRaw.description,
            deadline: Number(pRaw.deadline),
            terminated: pRaw.terminated,
            winnerDeclared: pRaw.winnerDeclared,
            winner: pRaw.winner,
            lowestBid: Number(pRaw.lowestBid),
            highestBid: Number(pRaw.highestBid),
            numBids: Number(stats[0]),
            averageBid: Number(stats[1]),
          });
        } catch (e) {
          console.warn(`Failed to load project ${i}`, e);
        }
      }
      
      setProjects(list);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const createProject = async (title: string, description: string, deadline: number) => {
    if (!title || !description) { 
      alert("Please enter title and description"); 
      return; 
    }
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.createProject(title, description, deadline);
      await tx.wait();
      setShowCreateModal(false);
      await loadProjects();
      alert("Project created successfully!");
    } catch (e: any) {
      alert("Creation failed: " + (e?.message || e));
    } finally {
      setCreating(false);
    }
  };

  const placeBid = async (projectId: number, amount: number) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.placeBid(projectId, amount);
      await tx.wait();
      setBiddingProjectId(null);
      setBiddingAmount("");
      await loadProjects();
      alert("Bid placed successfully!");
    } catch (e: any) {
      console.error("Bid failed", e);
      alert("Bid failed: " + (e?.message || e));
    }
  };

  const terminateProject = async (projectId: number) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    if (!window.confirm("Are you sure you want to terminate this project? This will reveal the winner and prevent any further bids.")) {
      return;
    }
    
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, ABI, signer);
      const tx = await contract.terminateProject(projectId);
      await tx.wait();
      await loadProjects();
      alert("Project terminated and winner revealed!");
    } catch (e: any) {
      console.error("Termination failed", e);
      alert("Termination failed: " + (e?.message || e));
    }
  };

  const getWinnerInfo = async (projectId: number) => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const winnerInfo = await contract.getWinner(projectId);
      alert(`Winner: ${winnerInfo[0]}\nWinning Bid: ${winnerInfo[1]} ETH`);
    } catch (e: any) {
      alert("Failed to get winner info: " + (e?.message || e));
    }
  };

  if (loading) return (
    <div style={{
      background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      color: "white",
      fontSize: "24px"
    }}>
      <div className="spinner"></div>
    </div>
  );

  // Filter projects based on active tab
  const filteredProjects = projects.filter(project => {
    if (activeTab === "all") return true;
    if (activeTab === "active") return !project.terminated && project.deadline * 1000 > Date.now();
    if (activeTab === "completed") return project.terminated || project.winnerDeclared;
    return true;
  });

  // ----------------- Aggregate Stats -----------------
  const totalProjects = projects.length;
  const totalBids = projects.reduce((sum, p) => sum + p.numBids, 0);
  const activeProjects = projects.filter(p => !p.terminated && p.deadline * 1000 > Date.now()).length;

  return (
    <div style={{ 
      fontFamily: "'Poppins', sans-serif", 
      minHeight: "100vh", 
      padding: 0, 
      background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
      color: "#fff",
      position: "relative",
      overflowX: "hidden"
    }}>
      {/* Animated background elements */}
      <div className="bg-bubbles">
        {[...Array(10)].map((_, i) => <div key={i} className="bubble"></div>)}
      </div>

      {/* Navbar */}
      <header style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        marginBottom: 32, 
        alignItems: "center",
        backdropFilter: "blur(10px)",
        background: "rgba(255, 255, 255, 0.05)",
        padding: "16px 5%",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        position: "sticky",
        top: 0,
        zIndex: 100
      }}>
        <h1 style={{ 
          fontSize: 28, 
          fontWeight: "700", 
          margin: 0, 
          background: "linear-gradient(45deg, #8A2BE2, #00BFFF)", 
          backgroundClip: "text", 
          WebkitBackgroundClip: "text", 
          color: "transparent",
          display: "flex",
          alignItems: "center",
          gap: 10
        }}>
          <div style={{ 
            width: 12, 
            height: 12, 
            borderRadius: "50%", 
            background: "linear-gradient(45deg, #8A2BE2, #00BFFF)",
            boxShadow: "0 0 10px rgba(138, 43, 226, 0.5)"
          }}></div>
          Zama FHE Tender
          <div style={{ 
            width: 12, 
            height: 12, 
            borderRadius: "50%", 
            background: "linear-gradient(45deg, #00BFFF, #8A2BE2)",
            boxShadow: "0 0 10px rgba(0, 191, 255, 0.5)"
          }}></div>
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="glow-button"
            style={{
              padding: "10px 16px",
              background: "linear-gradient(45deg, #8A2BE2, #00BFFF)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: "0 0 15px rgba(138, 43, 226, 0.4)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.3s ease"
            }}
          >
            <FaPlus /> New Project
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {/* Main Content */}
      <div style={{ padding: "0 5%" }}>
        {/* Platform Intro */}
        <section style={{ 
          marginBottom: 32, 
          padding: 24, 
          borderRadius: 20, 
          background: "rgba(255, 255, 255, 0.05)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
          position: "relative",
          overflow: "hidden"
        }}>
          <div className="corner-shine"></div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 0 }}>
            <FaList /> Platform Overview
          </h2>
          <p>Create and participate in transparent bidding projects on the blockchain. The lowest valid bid wins the project.</p>

          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FaChartLine /> Statistics
          </h3>
          <div style={{ 
            display: "flex", 
            gap: 24,
            flexWrap: "wrap"
          }}>
            <div className="stat-card">
              <div style={{ fontSize: "12px", opacity: 0.8 }}>Total Projects</div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>{totalProjects}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: "12px", opacity: 0.8 }}>Total Bids</div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>{totalBids}</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: "12px", opacity: 0.8 }}>Active Projects</div>
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>{activeProjects}</div>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div style={{ 
          display: "flex", 
          gap: 16, 
          marginBottom: 24,
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: 12,
          padding: 8,
          width: "fit-content"
        }}>
          {[
            { id: "all", label: "All Projects" },
            { id: "active", label: "Active" },
            { id: "completed", label: "Completed" }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: activeTab === tab.id ? "linear-gradient(45deg, #8A2BE2, #00BFFF)" : "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: "600",
                transition: "all 0.3s ease"
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Projects Grid */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", 
          gap: 24,
          marginBottom: 40
        }}>
          {filteredProjects.length === 0 ? (
            <div style={{ 
              gridColumn: "1 / -1",
              padding: 40, 
              textAlign: "center", 
              borderRadius: 20, 
              background: "rgba(255, 255, 255, 0.05)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}>
              <h3>No projects found</h3>
              <p>Create the first project to get started!</p>
            </div>
          ) : (
            filteredProjects.map(project => {
              const isCreator = account && checkIsCreator(account, project.creator);
              const isActive = !project.terminated && project.deadline * 1000 > Date.now();
              const isCompleted = project.terminated || project.winnerDeclared;
              
              return (
                <div key={project.id} className="project-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>{project.title}</h3>
                    <div style={{ 
                      padding: "4px 8px", 
                      borderRadius: 4, 
                      fontSize: "12px", 
                      fontWeight: "bold",
                      background: isCompleted ? "rgba(76, 175, 80, 0.2)" : 
                                  isActive ? "rgba(33, 150, 243, 0.2)" : "rgba(158, 158, 158, 0.2)",
                      color: isCompleted ? "#4caf50" : isActive ? "#2196f3" : "#9e9e9e"
                    }}>
                      {isCompleted ? "COMPLETED" : isActive ? "ACTIVE" : "CLOSED"}
                    </div>
                  </div>
                  
                  <p style={{ marginTop: 0, marginBottom: 16, opacity: 0.9, fontSize: 14 }}>{project.description}</p>
                  
                  <div style={{ display: "flex", gap: 16, fontSize: 14, opacity: 0.9, marginBottom: 16, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <FaClock size={14} /> Deadline: {new Date(project.deadline * 1000).toLocaleString()}
                    </span>
                    <span>Bids: {project.numBids}</span>
                  </div>
                  
                  {isCompleted && project.winnerDeclared && (
                    <div style={{ 
                      padding: "12px", 
                      marginBottom: 16, 
                      borderRadius: 8, 
                      background: "rgba(76, 175, 80, 0.1)",
                      border: "1px solid rgba(76, 175, 80, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}>
                      <FaTrophy color="#4caf50" />
                      <span>Winner: {project.winner.substring(0, 8)}...{project.winner.substring(project.winner.length - 6)}</span>
                      <span style={{marginLeft: "auto"}}>{project.lowestBid} ETH</span>
                      <button 
                        onClick={() => getWinnerInfo(project.id)}
                        style={{
                          padding: "4px 8px",
                          background: "transparent",
                          color: "#4caf50",
                          border: "1px solid #4caf50",
                          borderRadius: 4,
                          fontSize: "12px",
                          cursor: "pointer"
                        }}
                      >
                        Details
                      </button>
                    </div>
                  )}
                  
                  {isActive && (
                    <div style={{ 
                      padding: "12px", 
                      marginBottom: 16, 
                      borderRadius: 8, 
                      background: "rgba(33, 150, 243, 0.1)",
                      border: "1px solid rgba(33, 150, 243, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}>
                      <FaEyeSlash size={14} color="#2196f3" />
                      <span>Bidding details will be revealed after completion</span>
                    </div>
                  )}
                  
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {isActive && account && (
                      <button 
                        onClick={() => setBiddingProjectId(project.id)} 
                        className="glow-button"
                        style={{ 
                          padding: "8px 12px", 
                          borderRadius: 8, 
                          background: "linear-gradient(45deg, #8A2BE2, #00BFFF)", 
                          color: "#fff", 
                          border: "none", 
                          cursor: "pointer",
                          fontWeight: "600",
                          fontSize: "14px"
                        }}
                      >
                        Place Bid
                      </button>
                    )}
                    
                    {isCreator && isActive && (
                      <button 
                        onClick={() => terminateProject(project.id)}
                        style={{ 
                          padding: "8px 12px", 
                          borderRadius: 8, 
                          background: "rgba(244, 67, 54, 0.2)", 
                          color: "#f44336", 
                          border: "1px solid rgba(244, 67, 54, 0.3)", 
                          cursor: "pointer",
                          fontWeight: "600",
                          fontSize: "14px",
                          display: "flex",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        <FaLock size={12} /> Terminate
                      </button>
                    )}
                  </div>
                  
                  {/* Bid Form */}
                  {biddingProjectId === project.id && (
                    <div style={{ 
                      marginTop: 16, 
                      padding: "16px", 
                      borderRadius: 8, 
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)"
                    }}>
                      <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Place Your Bid (ETH)</h4>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input 
                          type="number" 
                          value={biddingAmount} 
                          onChange={e => setBiddingAmount(e.target.value)} 
                          placeholder="Bid amount (ETH)" 
                          step="0.001"
                          min="0.001"
                          style={{ 
                            padding: "8px 12px", 
                            borderRadius: 4,
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            background: "rgba(255, 255, 255, 0.1)",
                            color: "white",
                            flex: "1",
                            minWidth: "120px"
                          }}
                        />
                        <button 
                          onClick={() => placeBid(project.id, Number(biddingAmount))}
                          style={{ 
                            padding: "8px 12px", 
                            borderRadius: 8, 
                            background: "linear-gradient(45deg, #8A2BE2, #00BFFF)", 
                            color: "#fff", 
                            border: "none", 
                            cursor: "pointer",
                            fontWeight: "600"
                          }}
                        >
                          Submit Bid
                        </button>
                        <button 
                          onClick={() => setBiddingProjectId(null)}
                          style={{ 
                            padding: "8px 12px", 
                            borderRadius: 8, 
                            background: "transparent", 
                            color: "#fff", 
                            border: "1px solid rgba(255, 255, 255, 0.3)", 
                            cursor: "pointer"
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <ModalCreate 
          onCreate={createProject} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
        />
      )}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
        
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top: 4px solid #8A2BE2;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .project-card {
          padding: 24px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        
        .project-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(138, 43, 226, 0.5), transparent);
        }
        
        .project-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.15);
          border-color: rgba(138, 43, 226, 0.3);
        }
        
        .stat-card {
          background: linear-gradient(45deg, rgba(138, 43, 226, 0.2), rgba(0, 191, 255, 0.2));
          padding: 16px;
          border-radius: 12px;
          min-width: 120px;
          text-align: center;
          backdrop-filter: blur(5px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }
        
        .stat-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(138, 43, 226, 0.2);
        }
        
        .glow-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 0 20px rgba(138, 43, 226, 0.6);
        }
        
        .bg-bubbles {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: -1;
          overflow: hidden;
        }
        
        .bubble {
          position: absolute;
          border-radius: 50%;
          background: rgba(138, 43, 226, 0.1);
          animation: float 15s infinite ease-in-out;
        }
        
        .bubble:nth-child(1) {
          width: 80px;
          height: 80px;
          left: 10%;
          top: 10%;
          animation-delay: 0s;
        }
        
        .bubble:nth-child(2) {
          width: 120px;
          height: 120px;
          left: 20%;
          top: 20%;
          animation-delay: -2s;
        }
        
        .bubble:nth-child(3) {
          width: 60px;
          height: 60px;
          left: 30%;
          top: 30%;
          animation-delay: -4s;
        }
        
        .bubble:nth-child(4) {
          width: 100px;
          height: 100px;
          left: 40%;
          top: 40%;
          animation-delay: -6s;
        }
        
        .bubble:nth-child(5) {
          width: 70px;
          height: 70px;
          left: 50%;
          top: 50%;
          animation-delay: -8s;
        }
        
        .bubble:nth-child(6) {
          width: 90px;
          height: 90px;
          left: 60%;
          top: 60%;
          animation-delay: -10s;
        }
        
        .bubble:nth-child(7) {
          width: 110px;
          height: 110px;
          left: 70%;
          top: 70%;
          animation-delay: -12s;
        }
        
        .bubble:nth-child(8) {
          width: 80px;
          height: 80px;
          left: 80%;
          top: 80%;
          animation-delay: -14s;
        }
        
        @keyframes float {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(10deg);
          }
        }
        
        .corner-shine {
          position: absolute;
          top: 0;
          right: 0;
          width: 100px;
          height: 100px;
          background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
          transform: rotate(45deg) translate(35px, -65px);
        }
      `}</style>
    </div>
  );
}

// ------------------- Create Project Modal -------------------
function ModalCreate({ onCreate, onClose, creating }: { 
  onCreate: (title: string, description: string, deadline: number) => void; 
  onClose: () => void; 
  creating: boolean; 
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");

  const handleSubmit = () => {
    const deadlineTimestamp = Math.floor(new Date(deadline).getTime() / 1000);
    if (!title || !description || !deadline || isNaN(deadlineTimestamp)) {
      alert("Please fill all fields with valid values");
      return;
    }
    onCreate(title, description, deadlineTimestamp);
  };

  return (
    <div style={{
      position: "fixed", 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0,
      background: "rgba(0, 0, 0, 0.8)", 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center",
      zIndex: 1000,
      backdropFilter: "blur(5px)"
    }}>
      <div style={{ 
        background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)", 
        borderRadius: 20, 
        padding: 32, 
        width: "90%",
        maxWidth: 500,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
        position: "relative",
        overflow: "hidden"
      }}>
        <div className="corner-shine"></div>
        <h2 style={{ marginTop: 0, color: "white", textAlign: "center" }}>Create New Project</h2>
        
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: "600" }}>Title</label>
          <input 
            value={title} 
            onChange={e => setTitle(e.target.value)} 
            placeholder="Project title" 
            style={{ 
              width: "100%", 
              padding: 12, 
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(255, 255, 255, 0.1)",
              color: "white",
              fontSize: "16px"
            }}
          />
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: "600" }}>Description</label>
          <textarea 
            value={description} 
            onChange={e => setDescription(e.target.value)} 
            placeholder="Project description" 
            rows={4}
            style={{ 
              width: "100%", 
              padding: 12, 
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(255, 255, 255, 0.1)",
              color: "white",
              fontSize: "16px",
              resize: "vertical"
            }}
          />
        </div>
        
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: "600" }}>Bidding Deadline</label>
          <input 
            type="datetime-local" 
            value={deadline} 
            onChange={e => setDeadline(e.target.value)} 
            style={{ 
              width: "100%", 
              padding: 12, 
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(255, 255, 255, 0.1)",
              color: "white",
              fontSize: "16px"
            }}
          />
        </div>
        
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button 
            onClick={onClose}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(255, 255, 255, 0.1)",
              color: "white",
              cursor: "pointer",
              fontWeight: "600"
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="glow-button"
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(45deg, #8A2BE2, #00BFFF)",
              color: "white",
              cursor: creating ? "not-allowed" : "pointer",
              opacity: creating ? 0.7 : 1,
              fontWeight: "600"
            }}
          >
            {creating ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}