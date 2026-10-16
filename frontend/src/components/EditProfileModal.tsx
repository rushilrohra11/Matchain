import React, { useState } from 'react';
import {
  X,
  User as UserIcon,
  Briefcase,
  Building2,
  Mail,
  Key,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWalletState } from '../services/wallet';

export const RESEARCH_ROLES = [
  'Materials Scientist',
  'Computational Chemist',
  'Solid-State Physicist',
  'Battery & Energy Storage Engineer',
  'Crystallographer & Mineralogist',
  'Polymer & Soft Matter Researcher',
  'Nanotechnology Engineer',
  'Metallurgist & Alloys Specialist',
  'Machine Learning / AI Materials Scientist',
  'Academic Faculty / Professor',
  'Postdoctoral Researcher / PhD Candidate',
  'Undergraduate / Graduate Student',
  'Industry R&D Specialist',
  'Other',
];

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
  const { user, userProfile, updateUserProfile } = useAuth();
  const wallet = useWalletState();
  const activeWallet = wallet?.connected && wallet?.address ? wallet.address : userProfile?.walletAddress;

  const currentRole = userProfile?.role || 'Materials Scientist';
  const isCustomRole = !RESEARCH_ROLES.slice(0, -1).includes(currentRole);

  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [selectedRole, setSelectedRole] = useState(isCustomRole ? 'Other' : currentRole);
  const [customRole, setCustomRole] = useState(isCustomRole ? currentRole : '');
  const [organization, setOrganization] = useState(userProfile?.organization || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const finalRole = selectedRole === 'Other' ? customRole.trim() : selectedRole;
    if (!finalRole) {
      setError('Please specify your research role or field.');
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile({
        displayName: displayName.trim() || undefined,
        role: finalRole,
        organization: organization.trim() || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setError(err?.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-700/80 bg-slate-900/95 p-6 md:p-8 shadow-2xl shadow-indigo-950/50">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Edit Researcher Profile</h2>
            <p className="text-xs text-slate-400">Update your researcher identity and institution</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Profile updated successfully!</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* Editable: Full Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Full Name / Display Name
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Dr. Marie Curie"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 py-2.5 pl-10 pr-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Editable: Research Role */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Research Role / Scientific Field
            </label>
            <div className="relative">
              <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 py-2.5 pl-10 pr-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {RESEARCH_ROLES.map((r) => (
                  <option key={r} value={r} className="bg-slate-900 text-white">
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {selectedRole === 'Other' && (
              <div className="mt-2.5">
                <input
                  type="text"
                  required
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  placeholder="Specify your scientific role / field (e.g., Quantum Materials Analyst)"
                  className="w-full rounded-xl border border-indigo-500/50 bg-slate-950/90 py-2 px-3 text-xs text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Editable: Institution */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Institution / Laboratory / Organization
            </label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="National Lab / MIT / Independent Lab"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 py-2.5 pl-10 pr-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Locked / Read-Only Fields Section */}
          <div className="pt-3 border-t border-slate-800 space-y-2.5 text-xs text-slate-400">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              <span>Immutable Account Details</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-950/50 px-3 py-2 border border-slate-800/80">
              <span className="flex items-center gap-2 text-slate-400">
                <Mail className="h-3.5 w-3.5" /> Email
              </span>
              <span className="text-slate-300 font-mono text-[11px]">{user?.email || '—'}</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-950/50 px-3 py-2 border border-slate-800/80">
              <span className="flex items-center gap-2 text-slate-400">
                <Key className="h-3.5 w-3.5" /> Researcher ID (UID)
              </span>
              <span className="text-slate-400 font-mono text-[11px]">{user?.uid?.slice(0, 12)}…</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-950/50 px-3 py-2 border border-slate-800/80">
              <span className="flex items-center gap-2 text-slate-400">
                <Wallet className="h-3.5 w-3.5 text-indigo-400" /> Linked Web3 Wallet
              </span>
              {activeWallet ? (
                <span className="inline-flex items-center gap-2 text-emerald-300 font-mono text-[11px]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]"></span>
                  </span>
                  <span>{activeWallet.slice(0, 8)}…{activeWallet.slice(-6)}</span>
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/30">Linked</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-slate-400 text-[11px]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]"></span>
                  </span>
                  <span>Not linked (connect in top bar)</span>
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="button-secondary text-xs px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="button-primary text-xs px-5 py-2 shadow-lg shadow-indigo-600/30 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
