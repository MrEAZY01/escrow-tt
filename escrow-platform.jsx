import React, { useState, useEffect, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// CONTEXT & STATE MANAGEMENT
// ============================================================================

const AppContext = createContext();

const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

// ============================================================================
// SIMULATED BACKEND / DATABASE
// ============================================================================

class Database {
  constructor() {
    this.users = [
      { id: 1, username: 'alice', email: 'alice@example.com', password: 'password123' },
      { id: 2, username: 'bob', email: 'bob@example.com', password: 'password123' }
    ];
    this.deals = [];
    this.transactions = [];
    this.disputes = [];
    this.notifications = [];
    this.inviteCodes = new Map();
    this.nextUserId = 3;
    this.nextDealId = 1;
  }

  // User operations
  createUser(username, email, password) {
    if (this.users.find(u => u.username === username)) {
      throw new Error('Username already exists');
    }
    if (this.users.find(u => u.email === email)) {
      throw new Error('Email already exists');
    }
    const user = { id: this.nextUserId++, username, email, password };
    this.users.push(user);
    return { ...user, password: undefined };
  }

  authenticateUser(email, password) {
    const user = this.users.find(u => u.email === email && u.password === password);
    if (!user) throw new Error('Invalid credentials');
    return { ...user, password: undefined };
  }

  findUserByUsername(username) {
    return this.users.find(u => u.username === username);
  }

  // Deal operations
  createDeal(creatorId, dealData) {
    const code = this.generateInviteCode();
    const deal = {
      id: this.nextDealId++,
      ...dealData,
      creatorId,
      status: dealData.inviteType === 'code' ? 'waiting_for_other_party' : 'waiting_for_other_party',
      paymentStatus: 'unpaid',
      createdAt: new Date().toISOString(),
      inviteCode: dealData.inviteType === 'code' ? code : null,
      messages: []
    };
    this.deals.push(deal);
    
    if (dealData.inviteType === 'code') {
      this.inviteCodes.set(code, deal.id);
    } else if (dealData.inviteType === 'username' && dealData.invitedUsername) {
      const invitedUser = this.findUserByUsername(dealData.invitedUsername);
      if (invitedUser) {
        this.notifications.push({
          userId: invitedUser.id,
          dealId: deal.id,
          type: 'deal_invitation',
          message: `${this.users.find(u => u.id === creatorId).username} invited you to a deal`,
          read: false
        });
      }
    }
    
    return deal;
  }

  joinDealByCode(userId, code) {
    const dealId = this.inviteCodes.get(code);
    if (!dealId) throw new Error('Invalid invite code');
    
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    
    if (deal.creatorId === userId) {
      throw new Error('Cannot join your own deal');
    }
    
    if (deal.status !== 'waiting_for_other_party') {
      throw new Error('Deal already has both parties');
    }
    
    // Assign user to correct role
    if (deal.creatorRole === 'payer') {
      deal.payerId = deal.creatorId;
      deal.providerId = userId;
    } else {
      deal.providerId = deal.creatorId;
      deal.payerId = userId;
    }
    
    deal.status = 'waiting_for_funding';
    this.inviteCodes.delete(code);
    return deal;
  }

  acceptDealInvitation(userId, dealId) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    
    if (deal.creatorRole === 'payer') {
      deal.payerId = deal.creatorId;
      deal.providerId = userId;
    } else {
      deal.providerId = deal.creatorId;
      deal.payerId = userId;
    }
    
    deal.status = 'waiting_for_funding';
    return deal;
  }

  fundDeal(userId, dealId) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    if (deal.payerId !== userId) throw new Error('Only the payer can fund this deal');
    if (deal.status !== 'waiting_for_funding') throw new Error('Deal is not ready for funding');
    
    deal.paymentStatus = 'funded';
    deal.status = 'work_in_progress';
    deal.fundedAt = new Date().toISOString();
    
    this.transactions.push({
      dealId,
      type: 'escrow_deposit',
      amount: deal.amount,
      timestamp: new Date().toISOString()
    });
    
    return deal;
  }

  markWorkComplete(userId, dealId) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    if (deal.providerId !== userId) throw new Error('Only the service provider can mark work as complete');
    if (deal.status !== 'work_in_progress') throw new Error('Work is not in progress');
    
    deal.status = 'completed_awaiting_confirmation';
    deal.completedAt = new Date().toISOString();
    return deal;
  }

  confirmAndRelease(userId, dealId) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    if (deal.payerId !== userId) throw new Error('Only the payer can confirm and release funds');
    if (deal.status !== 'completed_awaiting_confirmation') throw new Error('Work is not complete');
    
    deal.status = 'released';
    deal.releasedAt = new Date().toISOString();
    
    this.transactions.push({
      dealId,
      type: 'payout',
      amount: deal.amount,
      timestamp: new Date().toISOString()
    });
    
    return deal;
  }

  raiseDispute(userId, dealId, reason) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    if (![deal.payerId, deal.providerId].includes(userId)) {
      throw new Error('You are not part of this deal');
    }
    
    deal.status = 'disputed';
    const dispute = {
      dealId,
      raisedBy: userId,
      reason,
      status: 'open',
      createdAt: new Date().toISOString(),
      messages: []
    };
    this.disputes.push(dispute);
    return deal;
  }

  addDisputeMessage(userId, dealId, message) {
    const dispute = this.disputes.find(d => d.dealId === dealId);
    if (!dispute) throw new Error('No dispute found for this deal');
    
    dispute.messages.push({
      userId,
      message,
      timestamp: new Date().toISOString()
    });
    return dispute;
  }

  resolveDispute(dealId, releaseTo) {
    const deal = this.deals.find(d => d.id === dealId);
    const dispute = this.disputes.find(d => d.dealId === dealId);
    
    if (!deal || !dispute) throw new Error('Deal or dispute not found');
    
    deal.status = 'released';
    dispute.status = 'resolved';
    dispute.resolvedAt = new Date().toISOString();
    dispute.resolution = `Funds released to ${releaseTo === 'payer' ? 'payer' : 'provider'}`;
    
    this.transactions.push({
      dealId,
      type: 'dispute_resolution',
      amount: deal.amount,
      releasedTo: releaseTo,
      timestamp: new Date().toISOString()
    });
    
    return deal;
  }

  cancelDeal(userId, dealId) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');
    if (deal.status === 'funded' || deal.status === 'work_in_progress') {
      throw new Error('Cannot cancel a funded deal');
    }
    
    deal.status = 'cancelled';
    return deal;
  }

  getUserDeals(userId) {
    return this.deals.filter(d => 
      d.creatorId === userId || d.payerId === userId || d.providerId === userId
    );
  }

  getNotifications(userId) {
    return this.notifications.filter(n => n.userId === userId);
  }

  generateInviteCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

const db = new Database();

// ============================================================================
// COMPONENTS
// ============================================================================

// Auth Components
function LoginPage({ onLogin, onSwitchToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    try {
      const user = db.authenticateUser(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="auth-container"
    >
      <div className="auth-box">
        <div className="auth-header">
          <h1>SecureHold</h1>
          <p>Sign in to your account</p>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button type="submit" className="btn-primary">Sign In</button>
        </form>
        
        <div className="auth-footer">
          Don't have an account?{' '}
          <button onClick={onSwitchToSignup} className="link-button">Sign up</button>
        </div>
        
        <div className="demo-credentials">
          <strong>Demo accounts:</strong>
          <div>alice@example.com / password123</div>
          <div>bob@example.com / password123</div>
        </div>
      </div>
    </motion.div>
  );
}

function SignupPage({ onSignup, onSwitchToLogin }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    try {
      const user = db.createUser(username, email, password);
      onSignup(user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="auth-container"
    >
      <div className="auth-box">
        <div className="auth-header">
          <h1>SecureHold</h1>
          <p>Create your account</p>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a unique username"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button type="submit" className="btn-primary">Create Account</button>
        </form>
        
        <div className="auth-footer">
          Already have an account?{' '}
          <button onClick={onSwitchToLogin} className="link-button">Sign in</button>
        </div>
      </div>
    </motion.div>
  );
}

// Dashboard Components
function DealCard({ deal, currentUser, onClick }) {
  const isUserPayer = deal.payerId === currentUser.id;
  const isUserProvider = deal.providerId === currentUser.id;
  const otherUserId = isUserPayer ? deal.providerId : deal.payerId;
  const otherUser = db.users.find(u => u.id === otherUserId);
  
  const statusColors = {
    waiting_for_other_party: '#f59e0b',
    waiting_for_funding: '#3b82f6',
    work_in_progress: '#8b5cf6',
    completed_awaiting_confirmation: '#10b981',
    released: '#059669',
    disputed: '#ef4444',
    cancelled: '#6b7280'
  };

  const statusLabels = {
    waiting_for_other_party: 'Waiting for Other Party',
    waiting_for_funding: 'Waiting for Funding',
    work_in_progress: 'Work in Progress',
    completed_awaiting_confirmation: 'Awaiting Confirmation',
    released: 'Released',
    disputed: 'Disputed',
    cancelled: 'Cancelled'
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="deal-card"
      style={{ borderLeftColor: statusColors[deal.status] }}
    >
      <div className="deal-card-header">
        <h3>{deal.serviceDescription}</h3>
        <div className="deal-amount">${deal.amount}</div>
      </div>
      
      <div className="deal-card-body">
        <div className="deal-info-row">
          <span className="label">Other Party:</span>
          <span className="value">{otherUser?.username || 'Pending'}</span>
        </div>
        
        <div className="deal-info-row">
          <span className="label">Your Role:</span>
          <span className="value">{isUserPayer ? 'Payer' : 'Service Provider'}</span>
        </div>
        
        <div className="deal-info-row">
          <span className="label">Deadline:</span>
          <span className="value">{new Date(deal.deadline).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div className="deal-card-footer">
        <div 
          className="status-badge"
          style={{ backgroundColor: statusColors[deal.status] }}
        >
          {statusLabels[deal.status]}
        </div>
        
        {deal.paymentStatus === 'funded' && (
          <div className="escrow-badge">
            🔒 Funds Secured
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Dashboard({ currentUser, onCreateDeal, onViewDeal, onLogout }) {
  const [activeTab, setActiveTab] = useState('active');
  const userDeals = db.getUserDeals(currentUser.id);
  
  const activeDeals = userDeals.filter(d => 
    ['waiting_for_other_party', 'waiting_for_funding', 'work_in_progress', 'completed_awaiting_confirmation'].includes(d.status)
  );
  
  const completedDeals = userDeals.filter(d => d.status === 'released');
  const disputedDeals = userDeals.filter(d => d.status === 'disputed');
  const notifications = db.getNotifications(currentUser.id);
  
  const dealsToShow = activeTab === 'active' ? activeDeals : 
                      activeTab === 'completed' ? completedDeals : disputedDeals;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Welcome back, {currentUser.username}</h1>
          <p className="subtitle">Manage your escrow transactions</p>
        </div>
        <div className="header-actions">
          <button onClick={onCreateDeal} className="btn-primary">
            + New Deal
          </button>
          <button onClick={onLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </div>
      
      {notifications.length > 0 && (
        <div className="notifications-banner">
          <span className="notification-icon">🔔</span>
          You have {notifications.length} pending notification(s)
        </div>
      )}
      
      <div className="dashboard-tabs">
        <button 
          className={activeTab === 'active' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('active')}
        >
          Active Deals ({activeDeals.length})
        </button>
        <button 
          className={activeTab === 'completed' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('completed')}
        >
          Completed ({completedDeals.length})
        </button>
        <button 
          className={activeTab === 'disputed' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('disputed')}
        >
          Disputed ({disputedDeals.length})
        </button>
      </div>
      
      <div className="deals-grid">
        <AnimatePresence>
          {dealsToShow.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="empty-state"
            >
              <div className="empty-icon">📋</div>
              <h3>No {activeTab} deals</h3>
              <p>Create a new deal to get started</p>
            </motion.div>
          ) : (
            dealsToShow.map(deal => (
              <DealCard
                key={deal.id}
                deal={deal}
                currentUser={currentUser}
                onClick={() => onViewDeal(deal)}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Create Deal Flow
function CreateDealModal({ currentUser, onClose, onDealCreated }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    serviceDescription: '',
    amount: '',
    deadline: '',
    role: 'payer',
    inviteType: 'code',
    invitedUsername: ''
  });
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const dealData = {
        serviceDescription: formData.serviceDescription,
        amount: parseFloat(formData.amount),
        deadline: formData.deadline,
        creatorRole: formData.role,
        inviteType: formData.inviteType,
        invitedUsername: formData.inviteType === 'username' ? formData.invitedUsername : null
      };
      
      const deal = db.createDeal(currentUser.id, dealData);
      
      if (formData.inviteType === 'code') {
        setCreatedCode(deal.inviteCode);
        setStep(3);
      } else {
        onDealCreated(deal);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Create New Deal</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="modal-form">
            <div className="form-group">
              <label>Service Description</label>
              <textarea
                value={formData.serviceDescription}
                onChange={(e) => setFormData({...formData, serviceDescription: e.target.value})}
                placeholder="Describe the service to be provided"
                rows={4}
                required
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({...formData, amount: e.target.value})}
                  placeholder="0.00"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Deadline</label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => setFormData({...formData, deadline: e.target.value})}
                  min={new Date().toISOString().split('T')[0]}
                  required
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>Your Role</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    value="payer"
                    checked={formData.role === 'payer'}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                  />
                  I am paying for the service
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    value="provider"
                    checked={formData.role === 'provider'}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                  />
                  I am providing the service
                </label>
              </div>
            </div>
            
            <button type="submit" className="btn-primary">Continue</button>
          </form>
        )}
        
        {step === 2 && (
          <form onSubmit={handleSubmit} className="modal-form">
            {error && <div className="error-message">{error}</div>}
            
            <div className="form-group">
              <label>How do you want to invite the other party?</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    value="code"
                    checked={formData.inviteType === 'code'}
                    onChange={(e) => setFormData({...formData, inviteType: e.target.value})}
                  />
                  Generate an invite code (share it outside the app)
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    value="username"
                    checked={formData.inviteType === 'username'}
                    onChange={(e) => setFormData({...formData, inviteType: e.target.value})}
                  />
                  Invite by username (send in-app notification)
                </label>
              </div>
            </div>
            
            {formData.inviteType === 'username' && (
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={formData.invitedUsername}
                  onChange={(e) => setFormData({...formData, invitedUsername: e.target.value})}
                  placeholder="Enter their username"
                  required
                />
              </div>
            )}
            
            <div className="button-group">
              <button type="button" onClick={() => setStep(1)} className="btn-secondary">
                Back
              </button>
              <button type="submit" className="btn-primary">
                Create Deal
              </button>
            </div>
          </form>
        )}
        
        {step === 3 && (
          <div className="success-content">
            <div className="success-icon">✓</div>
            <h3>Deal Created Successfully!</h3>
            <p>Share this code with the other party:</p>
            <div className="invite-code-display">
              {createdCode}
            </div>
            <p className="help-text">
              They can enter this code on their dashboard to join the deal
            </p>
            <button onClick={() => onDealCreated()} className="btn-primary">
              Done
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// Deal Detail View
function DealDetailView({ deal, currentUser, onBack, onUpdate }) {
  const [showDispute, setShowDispute] = useState(false);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeMessage, setDisputeMessage] = useState('');
  const [error, setError] = useState('');
  
  const isUserPayer = deal.payerId === currentUser.id;
  const isUserProvider = deal.providerId === currentUser.id;
  const isUserCreator = deal.creatorId === currentUser.id;
  
  const payerUser = db.users.find(u => u.id === deal.payerId);
  const providerUser = db.users.find(u => u.id === deal.providerId);
  const dispute = db.disputes.find(d => d.dealId === deal.id);
  
  const handleJoinByCode = () => {
    try {
      const updatedDeal = db.joinDealByCode(currentUser.id, joinCode.toUpperCase());
      onUpdate(updatedDeal);
      setShowJoinCode(false);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleAcceptInvitation = () => {
    try {
      const updatedDeal = db.acceptDealInvitation(currentUser.id, deal.id);
      onUpdate(updatedDeal);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleFundDeal = () => {
    try {
      const updatedDeal = db.fundDeal(currentUser.id, deal.id);
      onUpdate(updatedDeal);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleMarkComplete = () => {
    try {
      const updatedDeal = db.markWorkComplete(currentUser.id, deal.id);
      onUpdate(updatedDeal);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleConfirmRelease = () => {
    try {
      const updatedDeal = db.confirmAndRelease(currentUser.id, deal.id);
      onUpdate(updatedDeal);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleRaiseDispute = () => {
    try {
      const updatedDeal = db.raiseDispute(currentUser.id, deal.id, disputeReason);
      onUpdate(updatedDeal);
      setShowDispute(false);
    } catch (err) {
      setError(err.message);
    }
  };
  
  const handleSendDisputeMessage = () => {
    if (disputeMessage.trim()) {
      db.addDisputeMessage(currentUser.id, deal.id, disputeMessage);
      setDisputeMessage('');
      onUpdate(deal);
    }
  };

  return (
    <div className="deal-detail-view">
      <div className="detail-header">
        <button onClick={onBack} className="back-button">← Back to Dashboard</button>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="detail-content">
        <div className="detail-main">
          <div className="detail-card">
            <h2>{deal.serviceDescription}</h2>
            
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Amount</span>
                <span className="detail-value amount">${deal.amount}</span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Deadline</span>
                <span className="detail-value">{new Date(deal.deadline).toLocaleDateString()}</span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value">
                  {deal.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">Payment Status</span>
                <span className="detail-value">
                  {deal.paymentStatus === 'funded' ? '🔒 Funds Secured in Escrow' : 'Not Funded'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="detail-card">
            <h3>Parties Involved</h3>
            
            <div className="parties-grid">
              <div className="party-item">
                <div className="party-role">Payer (Service Buyer)</div>
                <div className="party-name">
                  {payerUser ? `@${payerUser.username}` : 'Pending'}
                  {isUserPayer && <span className="you-badge">You</span>}
                </div>
              </div>
              
              <div className="party-item">
                <div className="party-role">Provider (Service Provider)</div>
                <div className="party-name">
                  {providerUser ? `@${providerUser.username}` : 'Pending'}
                  {isUserProvider && <span className="you-badge">You</span>}
                </div>
              </div>
            </div>
          </div>
          
          {/* Action Buttons */}
          {deal.status === 'waiting_for_other_party' && isUserCreator && deal.inviteCode && (
            <div className="detail-card action-card">
              <h3>Share Invite Code</h3>
              <p>Share this code with the other party to join the deal:</p>
              <div className="invite-code-display">{deal.inviteCode}</div>
            </div>
          )}
          
          {deal.status === 'waiting_for_other_party' && !isUserCreator && (
            <div className="detail-card action-card">
              <h3>Join This Deal</h3>
              {deal.inviteType === 'code' ? (
                showJoinCode ? (
                  <div>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Enter invite code"
                      className="code-input"
                    />
                    <button onClick={handleJoinByCode} className="btn-primary">
                      Join Deal
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setShowJoinCode(true)} className="btn-primary">
                    I Have an Invite Code
                  </button>
                )
              ) : (
                <button onClick={handleAcceptInvitation} className="btn-primary">
                  Accept Invitation
                </button>
              )}
            </div>
          )}
          
          {deal.status === 'waiting_for_funding' && isUserPayer && (
            <div className="detail-card action-card">
              <h3>Fund This Deal</h3>
              <p>Deposit ${deal.amount} into escrow to begin work</p>
              <button onClick={handleFundDeal} className="btn-primary btn-large">
                Fund Deal (Simulate Payment)
              </button>
              <p className="help-text">
                In production, this would integrate with a real payment gateway
              </p>
            </div>
          )}
          
          {deal.status === 'work_in_progress' && isUserProvider && (
            <div className="detail-card action-card">
              <h3>Mark Work as Complete</h3>
              <p>Once you've finished the service, mark it as complete</p>
              <button onClick={handleMarkComplete} className="btn-primary btn-large">
                Mark as Completed
              </button>
            </div>
          )}
          
          {deal.status === 'completed_awaiting_confirmation' && isUserPayer && (
            <div className="detail-card action-card">
              <h3>Confirm and Release Funds</h3>
              <p>Review the completed work and release payment</p>
              <div className="button-group">
                <button onClick={handleConfirmRelease} className="btn-success btn-large">
                  Confirm & Release ${deal.amount}
                </button>
                <button onClick={() => setShowDispute(true)} className="btn-danger">
                  Raise Dispute
                </button>
              </div>
            </div>
          )}
          
          {deal.status === 'disputed' && dispute && (
            <div className="detail-card">
              <h3>Dispute Details</h3>
              <div className="dispute-info">
                <p><strong>Raised by:</strong> {db.users.find(u => u.id === dispute.raisedBy)?.username}</p>
                <p><strong>Reason:</strong> {dispute.reason}</p>
                <p><strong>Status:</strong> {dispute.status}</p>
              </div>
              
              <div className="dispute-chat">
                <h4>Dispute Messages</h4>
                <div className="messages-container">
                  {dispute.messages.map((msg, idx) => (
                    <div key={idx} className={`message ${msg.userId === currentUser.id ? 'own' : 'other'}`}>
                      <div className="message-author">
                        {db.users.find(u => u.id === msg.userId)?.username}
                      </div>
                      <div className="message-text">{msg.message}</div>
                      <div className="message-time">
                        {new Date(msg.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="message-input">
                  <input
                    type="text"
                    value={disputeMessage}
                    onChange={(e) => setDisputeMessage(e.target.value)}
                    placeholder="Type a message..."
                    onKeyPress={(e) => e.key === 'Enter' && handleSendDisputeMessage()}
                  />
                  <button onClick={handleSendDisputeMessage} className="btn-primary">
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {deal.status === 'released' && (
            <div className="detail-card success-card">
              <div className="success-icon">✓</div>
              <h3>Deal Completed</h3>
              <p>Funds have been released to the service provider</p>
              <p className="timestamp">
                Released on {new Date(deal.releasedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Dispute Modal */}
      {showDispute && (
        <div className="modal-overlay" onClick={() => setShowDispute(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Raise a Dispute</h2>
              <button onClick={() => setShowDispute(false)} className="close-button">×</button>
            </div>
            
            <div className="modal-form">
              <div className="form-group">
                <label>Reason for Dispute</label>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Explain why you're raising a dispute..."
                  rows={6}
                  required
                />
              </div>
              
              <div className="warning-message">
                ⚠️ Once a dispute is raised, the funds will remain locked until an admin resolves it
              </div>
              
              <div className="button-group">
                <button onClick={() => setShowDispute(false)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={handleRaiseDispute} className="btn-danger">
                  Raise Dispute
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Admin Panel (Simple)
function AdminPanel({ onBack }) {
  const disputes = db.disputes.filter(d => d.status === 'open');
  const [selectedDispute, setSelectedDispute] = useState(null);
  
  const handleResolve = (dealId, releaseTo) => {
    db.resolveDispute(dealId, releaseTo);
    setSelectedDispute(null);
    window.location.reload(); // Simple refresh
  };
  
  return (
    <div className="admin-panel">
      <div className="detail-header">
        <button onClick={onBack} className="back-button">← Back</button>
        <h1>Admin Dashboard</h1>
      </div>
      
      <div className="admin-content">
        <h2>Open Disputes ({disputes.length})</h2>
        
        {disputes.length === 0 ? (
          <div className="empty-state">
            <p>No open disputes</p>
          </div>
        ) : (
          <div className="disputes-list">
            {disputes.map(dispute => {
              const deal = db.deals.find(d => d.id === dispute.dealId);
              const payer = db.users.find(u => u.id === deal.payerId);
              const provider = db.users.find(u => u.id === deal.providerId);
              
              return (
                <div key={dispute.dealId} className="admin-dispute-card">
                  <h3>Deal #{deal.id}: {deal.serviceDescription}</h3>
                  <p><strong>Amount:</strong> ${deal.amount}</p>
                  <p><strong>Payer:</strong> {payer?.username}</p>
                  <p><strong>Provider:</strong> {provider?.username}</p>
                  <p><strong>Raised by:</strong> {db.users.find(u => u.id === dispute.raisedBy)?.username}</p>
                  <p><strong>Reason:</strong> {dispute.reason}</p>
                  
                  <h4>Messages</h4>
                  <div className="admin-messages">
                    {dispute.messages.map((msg, idx) => (
                      <div key={idx} className="admin-message">
                        <strong>{db.users.find(u => u.id === msg.userId)?.username}:</strong> {msg.message}
                      </div>
                    ))}
                  </div>
                  
                  <div className="admin-actions">
                    <button 
                      onClick={() => handleResolve(deal.id, 'payer')}
                      className="btn-primary"
                    >
                      Release to Payer
                    </button>
                    <button 
                      onClick={() => handleResolve(deal.id, 'provider')}
                      className="btn-primary"
                    >
                      Release to Provider
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

export default function EscrowPlatform() {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('login'); // login, signup, dashboard, deal-detail, admin
  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [isSignup, setIsSignup] = useState(false);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setView('dashboard');
  };

  const handleSignup = (user) => {
    setCurrentUser(user);
    setView('dashboard');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('login');
  };

  const handleViewDeal = (deal) => {
    setSelectedDeal(deal);
    setView('deal-detail');
  };

  const handleDealUpdate = (updatedDeal) => {
    setSelectedDeal(updatedDeal);
  };

  return (
    <div className="app">
      {!currentUser ? (
        isSignup ? (
          <SignupPage 
            onSignup={handleSignup} 
            onSwitchToLogin={() => setIsSignup(false)}
          />
        ) : (
          <LoginPage 
            onLogin={handleLogin}
            onSwitchToSignup={() => setIsSignup(true)}
          />
        )
      ) : view === 'dashboard' ? (
        <>
          <Dashboard
            currentUser={currentUser}
            onCreateDeal={() => setShowCreateDeal(true)}
            onViewDeal={handleViewDeal}
            onLogout={handleLogout}
          />
          
          {/* Admin Link (hidden in production) */}
          <button 
            onClick={() => setView('admin')}
            className="admin-link"
            style={{ position: 'fixed', bottom: 20, right: 20, opacity: 0.3 }}
          >
            Admin Panel
          </button>
          
          {showCreateDeal && (
            <CreateDealModal
              currentUser={currentUser}
              onClose={() => setShowCreateDeal(false)}
              onDealCreated={() => {
                setShowCreateDeal(false);
                window.location.reload(); // Simple refresh
              }}
            />
          )}
        </>
      ) : view === 'deal-detail' ? (
        <DealDetailView
          deal={selectedDeal}
          currentUser={currentUser}
          onBack={() => setView('dashboard')}
          onUpdate={handleDealUpdate}
        />
      ) : view === 'admin' ? (
        <AdminPanel onBack={() => setView('dashboard')} />
      ) : null}

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          min-height: 100vh;
          color: #e2e8f0;
        }

        .app {
          min-height: 100vh;
        }

        /* Auth Styles */
        .auth-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .auth-box {
          background: rgba(30, 41, 59, 0.8);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.1);
          border-radius: 24px;
          padding: 48px;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .auth-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .auth-header h1 {
          font-size: 36px;
          font-weight: 700;
          background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }

        .auth-header p {
          color: #94a3b8;
          font-size: 16px;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          color: #cbd5e1;
          font-size: 14px;
          font-weight: 500;
        }

        .form-group input,
        .form-group textarea,
        .code-input {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          padding: 14px 16px;
          color: #e2e8f0;
          font-size: 15px;
          transition: all 0.2s;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .code-input:focus {
          outline: none;
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .radio-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px;
          background: rgba(15, 23, 42, 0.4);
          border-radius: 12px;
        }

        .radio-label {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          padding: 12px;
          border-radius: 8px;
          transition: background 0.2s;
        }

        .radio-label:hover {
          background: rgba(96, 165, 250, 0.1);
        }

        .radio-label input[type="radio"] {
          width: 20px;
          height: 20px;
          cursor: pointer;
        }

        .btn-primary {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          color: white;
          border: none;
          border-radius: 12px;
          padding: 14px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }

        .btn-secondary {
          background: rgba(100, 116, 139, 0.2);
          color: #cbd5e1;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          padding: 14px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-secondary:hover {
          background: rgba(100, 116, 139, 0.3);
        }

        .btn-success {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          border: none;
          border-radius: 12px;
          padding: 14px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-danger {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          border: none;
          border-radius: 12px;
          padding: 14px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-large {
          padding: 18px 32px;
          font-size: 18px;
        }

        .button-group {
          display: flex;
          gap: 12px;
        }

        .auth-footer {
          text-align: center;
          margin-top: 24px;
          color: #94a3b8;
        }

        .link-button {
          background: none;
          border: none;
          color: #60a5fa;
          cursor: pointer;
          font-size: inherit;
          text-decoration: underline;
        }

        .demo-credentials {
          margin-top: 32px;
          padding: 16px;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 12px;
          font-size: 13px;
          color: #94a3b8;
          text-align: center;
        }

        .demo-credentials strong {
          color: #cbd5e1;
          display: block;
          margin-bottom: 8px;
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
        }

        .warning-message {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #fbbf24;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
        }

        /* Dashboard */
        .dashboard {
          max-width: 1400px;
          margin: 0 auto;
          padding: 40px 20px;
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
        }

        .dashboard-header h1 {
          font-size: 32px;
          font-weight: 700;
          color: #f1f5f9;
        }

        .subtitle {
          color: #94a3b8;
          font-size: 16px;
          margin-top: 4px;
        }

        .header-actions {
          display: flex;
          gap: 12px;
        }

        .notifications-banner {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          padding: 16px 24px;
          border-radius: 12px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .notification-icon {
          font-size: 24px;
        }

        .dashboard-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 32px;
          border-bottom: 2px solid rgba(148, 163, 184, 0.1);
        }

        .tab {
          background: none;
          border: none;
          color: #94a3b8;
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          transition: all 0.2s;
        }

        .tab:hover {
          color: #cbd5e1;
        }

        .tab.active {
          color: #60a5fa;
          border-bottom-color: #60a5fa;
        }

        .deals-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 24px;
        }

        .deal-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.1);
          border-left: 4px solid;
          border-radius: 16px;
          padding: 24px;
          cursor: pointer;
          transition: all 0.3s;
        }

        .deal-card:hover {
          border-color: #60a5fa;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .deal-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }

        .deal-card-header h3 {
          font-size: 18px;
          font-weight: 600;
          color: #f1f5f9;
          flex: 1;
        }

        .deal-amount {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .deal-card-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }

        .deal-info-row {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
        }

        .deal-info-row .label {
          color: #94a3b8;
        }

        .deal-info-row .value {
          color: #cbd5e1;
          font-weight: 500;
        }

        .deal-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .status-badge {
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          color: white;
        }

        .escrow-badge {
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(16, 185, 129, 0.2);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .empty-state {
          grid-column: 1 / -1;
          text-align: center;
          padding: 80px 20px;
          color: #94a3b8;
        }

        .empty-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 24px;
          color: #cbd5e1;
          margin-bottom: 8px;
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .modal-content {
          background: rgba(30, 41, 59, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 24px;
          padding: 32px;
          width: 100%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .modal-header h2 {
          font-size: 24px;
          color: #f1f5f9;
        }

        .close-button {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 32px;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          width: 32px;
          height: 32px;
        }

        .close-button:hover {
          color: #cbd5e1;
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .success-content {
          text-align: center;
          padding: 20px;
        }

        .success-icon {
          font-size: 64px;
          color: #10b981;
          margin-bottom: 16px;
        }

        .success-content h3 {
          font-size: 24px;
          color: #f1f5f9;
          margin-bottom: 8px;
        }

        .invite-code-display {
          background: rgba(96, 165, 250, 0.1);
          border: 2px solid #60a5fa;
          border-radius: 12px;
          padding: 24px;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: 4px;
          color: #60a5fa;
          margin: 24px 0;
          font-family: 'Courier New', monospace;
        }

        .help-text {
          color: #94a3b8;
          font-size: 14px;
          margin: 16px 0;
        }

        /* Deal Detail */
        .deal-detail-view {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 20px;
        }

        .detail-header {
          margin-bottom: 32px;
        }

        .back-button {
          background: rgba(100, 116, 139, 0.2);
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #cbd5e1;
          padding: 10px 20px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .back-button:hover {
          background: rgba(100, 116, 139, 0.3);
        }

        .detail-content {
          display: grid;
          gap: 24px;
        }

        .detail-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.1);
          border-radius: 16px;
          padding: 32px;
        }

        .detail-card h2 {
          font-size: 28px;
          color: #f1f5f9;
          margin-bottom: 24px;
        }

        .detail-card h3 {
          font-size: 20px;
          color: #f1f5f9;
          margin-bottom: 16px;
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 24px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .detail-label {
          color: #94a3b8;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }

        .detail-value {
          color: #f1f5f9;
          font-size: 18px;
          font-weight: 600;
        }

        .detail-value.amount {
          font-size: 32px;
          background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .parties-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }

        .party-item {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 12px;
          padding: 20px;
        }

        .party-role {
          color: #94a3b8;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .party-name {
          color: #f1f5f9;
          font-size: 18px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .you-badge {
          background: #3b82f6;
          color: white;
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 4px;
          font-weight: 600;
        }

        .action-card {
          border: 2px solid #3b82f6;
          background: rgba(59, 130, 246, 0.05);
        }

        .success-card {
          border: 2px solid #10b981;
          background: rgba(16, 185, 129, 0.05);
          text-align: center;
        }

        .timestamp {
          color: #94a3b8;
          font-size: 14px;
          margin-top: 12px;
        }

        /* Dispute */
        .dispute-info {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
        }

        .dispute-info p {
          color: #cbd5e1;
          margin-bottom: 8px;
        }

        .dispute-chat {
          margin-top: 24px;
        }

        .messages-container {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 12px;
          padding: 20px;
          max-height: 400px;
          overflow-y: auto;
          margin-bottom: 16px;
        }

        .message {
          margin-bottom: 16px;
          padding: 12px;
          border-radius: 8px;
        }

        .message.own {
          background: rgba(59, 130, 246, 0.1);
          border-left: 3px solid #3b82f6;
        }

        .message.other {
          background: rgba(100, 116, 139, 0.1);
          border-left: 3px solid #64748b;
        }

        .message-author {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .message-text {
          color: #e2e8f0;
          font-size: 14px;
          margin-bottom: 4px;
        }

        .message-time {
          color: #64748b;
          font-size: 11px;
        }

        .message-input {
          display: flex;
          gap: 12px;
        }

        .message-input input {
          flex: 1;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          padding: 12px 16px;
          color: #e2e8f0;
        }

        /* Admin Panel */
        .admin-panel {
          max-width: 1400px;
          margin: 0 auto;
          padding: 40px 20px;
        }

        .admin-content {
          margin-top: 32px;
        }

        .disputes-list {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .admin-dispute-card {
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.1);
          border-radius: 16px;
          padding: 32px;
        }

        .admin-messages {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 12px;
          padding: 16px;
          margin: 16px 0;
          max-height: 200px;
          overflow-y: auto;
        }

        .admin-message {
          color: #cbd5e1;
          font-size: 14px;
          margin-bottom: 8px;
          padding: 8px;
          background: rgba(100, 116, 139, 0.1);
          border-radius: 6px;
        }

        .admin-actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }

        .admin-link {
          background: rgba(100, 116, 139, 0.2);
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #94a3b8;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .deals-grid {
            grid-template-columns: 1fr;
          }

          .form-row {
            grid-template-columns: 1fr;
          }

          .parties-grid {
            grid-template-columns: 1fr;
          }

          .detail-grid {
            grid-template-columns: 1fr;
          }

          .dashboard-header {
            flex-direction: column;
            gap: 20px;
          }

          .header-actions {
            width: 100%;
          }

          .header-actions button {
            flex: 1;
          }

          .button-group {
            flex-direction: column;
          }

          .button-group button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

