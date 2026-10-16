# -*- coding: utf-8 -*-
"""
MatChain — Generative Inverse Design + Blockchain-Enabled Provenance
Core Module & Pipeline Engine (Single Source of Truth)

Scientifically Honest Note:
This demo uses a property-conditioned composition+lattice VAE with structure grounding
from the Materials Project dataset. It is a simplified stand-in for the full CDVAE described in the paper.
"""

import os
import json
import time
import hashlib
import random
import warnings
import traceback
from functools import lru_cache
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

import torch
import torch.nn as nn
import torch.nn.functional as F

from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error

from pymatgen.core import Structure, Composition, Lattice
from pymatgen.analysis.phase_diagram import PhaseDiagram, PDEntry
from pymatgen.entries.computed_entries import ComputedEntry

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

device = "cuda" if torch.cuda.is_available() else "cpu"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LEDGER_PATH = os.path.join(BASE_DIR, "matchain_ledger.json")
IPFS_STORE_PATH = os.path.join(BASE_DIR, "matchain_ipfs_store.json")
MARKETPLACE_PATH = os.path.join(BASE_DIR, "matchain_marketplace.json")

DEFAULT_ELEMENT_VOCAB = [
    "Al", "B", "Ba", "Bi", "C", "Ca", "Cd", "Co", "Cr", "Cu", "Fe", "Ga",
    "Ge", "Hf", "In", "K", "Li", "Mg", "Mn", "Mo", "Na", "Nb", "Ni", "O",
    "P", "Pb", "S", "Sb", "Sc", "Si", "Sn", "Sr", "Ta", "Te", "Ti", "V",
    "W", "Y", "Zn", "Zr"
]

# =========================================================
# 1. Data Acquisition & Preprocessing
# =========================================================

def fetch_materials_project_data(api_key, n_samples=3000):
    """Fetch stable inorganic structures from Materials Project API."""
    if not api_key:
        raise ValueError("No Materials Project API key provided.")

    from mp_api.client import MPRester

    rows = []
    with MPRester(api_key) as mpr:
        chunk_size = 1000
        num_chunks = int(np.ceil(n_samples / chunk_size))
        docs = mpr.materials.summary.search(
            energy_above_hull=(0, 0.05),
            fields=[
                "material_id",
                "formula_pretty",
                "structure",
                "formation_energy_per_atom",
                "band_gap",
                "density",
                "energy_above_hull",
                "nsites",
            ],
            num_chunks=num_chunks,
            chunk_size=chunk_size,
        )

    for d in docs[:n_samples]:
        rows.append({
            "material_id": str(d.material_id),
            "formula": d.formula_pretty,
            "structure": d.structure,
            "formation_energy_per_atom": float(d.formation_energy_per_atom),
            "band_gap": float(d.band_gap) if d.band_gap is not None else 0.0,
            "density": float(d.density) if d.density is not None else 5.0,
            "energy_above_hull": float(d.energy_above_hull) if d.energy_above_hull is not None else 0.0,
            "nsites": int(d.nsites),
        })

    return pd.DataFrame(rows)


REFERENCE_SYSTEMS = [
    {
        "name": "Ti-V-Nb-Al",
        "elements": ["Ti", "V", "Nb", "Al"],
        "phases": [
            ("Ti", 0.0, 4.50, 0.0, 2),
            ("V", 0.0, 6.11, 0.0, 2),
            ("Nb", 0.0, 8.57, 0.0, 2),
            ("Al", 0.0, 2.70, 0.0, 4),
            ("TiAl", -0.42, 3.91, 0.0, 4),
            ("TiAl3", -0.38, 3.30, 0.0, 4),
            ("Ti3Al", -0.28, 4.20, 0.0, 4),
            ("NbAl3", -0.45, 4.54, 0.0, 4),
            ("VAl3", -0.35, 3.75, 0.0, 4),
            ("TiV2", -0.12, 5.50, 0.0, 3),
            ("Ti2AlNb", -0.36, 5.20, 0.0, 4),
            ("TiNbAl2", -0.39, 4.80, 0.0, 4),
        ],
    },
    {
        "name": "Fe-Ni-Cr",
        "elements": ["Fe", "Ni", "Cr"],
        "phases": [
            ("Fe", 0.0, 7.87, 0.0, 2),
            ("Ni", 0.0, 8.90, 0.0, 4),
            ("Cr", 0.0, 7.19, 0.0, 2),
            ("FeCr", -0.15, 7.50, 0.0, 4),
            ("Fe3Cr", -0.10, 7.70, 0.0, 4),
            ("CrFeNi2", -0.14, 8.10, 0.0, 4),
            ("Ni3Fe", -0.12, 8.60, 0.0, 4),
            ("FeNi", -0.09, 8.30, 0.0, 4),
        ],
    },
    {
        "name": "Li-Co-O",
        "elements": ["Li", "Co", "O"],
        "phases": [
            ("Li", 0.0, 0.53, 0.0, 2),
            ("Co", 0.0, 8.90, 0.0, 2),
            ("O", 0.0, 1.42, 0.0, 2),
            ("LiCoO2", -2.35, 5.06, 2.1, 4),
            ("Co3O4", -1.80, 6.07, 1.6, 7),
            ("CoO", -1.65, 6.44, 2.5, 4),
            ("Li2O", -2.05, 2.01, 7.2, 3),
            ("Li2O2", -1.70, 2.30, 4.5, 4),
            ("Li2CoO3", -2.25, 4.60, 2.4, 6),
        ],
    },
    {
        "name": "Na-Cl",
        "elements": ["Na", "Cl"],
        "phases": [
            ("Na", 0.0, 0.97, 0.0, 2),
            ("Cl", 0.0, 1.56, 0.0, 2),
            ("NaCl", -2.13, 2.16, 8.5, 2),
            ("Na2Cl", -1.40, 1.80, 5.0, 3),
            ("NaCl2", -1.35, 2.05, 4.8, 3),
        ],
    },
    {
        "name": "Si-O",
        "elements": ["Si", "O"],
        "phases": [
            ("Si", 0.0, 2.33, 1.1, 2),
            ("O", 0.0, 1.42, 0.0, 2),
            ("SiO2", -3.15, 2.65, 8.9, 3),
            ("SiO", -2.10, 2.13, 3.5, 2),
            ("Si2O3", -2.75, 2.45, 6.2, 5),
        ],
    },
    {
        "name": "Zn-S",
        "elements": ["Zn", "S"],
        "phases": [
            ("Zn", 0.0, 7.14, 0.0, 2),
            ("S", 0.0, 2.07, 2.6, 4),
            ("ZnS", -1.06, 4.09, 3.6, 2),
            ("Zn2S", -0.70, 5.20, 2.0, 3),
            ("ZnS2", -0.85, 3.50, 2.8, 3),
        ],
    },
    {
        "name": "Ba-Ti-O",
        "elements": ["Ba", "Ti", "O"],
        "phases": [
            ("Ba", 0.0, 3.51, 0.0, 2),
            ("Ti", 0.0, 4.50, 0.0, 2),
            ("O", 0.0, 1.42, 0.0, 2),
            ("BaTiO3", -3.42, 6.02, 3.2, 5),
            ("TiO2", -3.20, 4.23, 3.0, 3),
            ("BaO", -2.85, 5.72, 4.0, 2),
            ("BaTi2O5", -3.26, 5.20, 3.1, 8),
            ("Ba2TiO4", -3.10, 5.80, 3.4, 7),
        ],
    },
    {
        "name": "Mg-Al-O",
        "elements": ["Mg", "Al", "O"],
        "phases": [
            ("Mg", 0.0, 1.74, 0.0, 2),
            ("Al", 0.0, 2.70, 0.0, 4),
            ("O", 0.0, 1.42, 0.0, 2),
            ("MgAl2O4", -3.38, 3.60, 7.8, 7),
            ("Al2O3", -3.50, 3.95, 8.8, 5),
            ("MgO", -3.10, 3.58, 7.7, 2),
            ("Mg2Al4O7", -3.30, 3.70, 8.0, 13),
        ],
    },
]


def _make_structure_for_formula(formula, density, n_sites):
    comp = Composition(formula)
    amu = comp.weight
    volume = amu / (density * 0.602214)
    a = max(2.5, min(20.0, float(volume ** (1 / 3))))
    lattice = Lattice.cubic(a)
    elements_in_comp = comp.elements
    total_comp_atoms = comp.num_atoms
    species = []
    for el in elements_in_comp:
        count = max(1, int(round((comp[el] / total_comp_atoms) * n_sites)))
        species.extend([el.symbol] * count)
    while len(species) < n_sites:
        species.append(random.choice(elements_in_comp).symbol)
    species = species[:n_sites]

    if n_sites == 1:
        coords = np.array([[0.0, 0.0, 0.0]])
    elif n_sites == 2:
        coords = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.5]])
    elif n_sites == 3:
        coords = np.array([[0.0, 0.0, 0.0], [0.33, 0.33, 0.33], [0.67, 0.67, 0.67]])
    elif n_sites == 4:
        coords = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.0], [0.5, 0.0, 0.5], [0.0, 0.5, 0.5]])
    elif n_sites == 5:
        coords = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.5], [0.5, 0.5, 0.0], [0.5, 0.0, 0.5], [0.0, 0.5, 0.5]])
    else:
        coords = np.linspace(0.05, 0.95, n_sites * 3).reshape(n_sites, 3) % 1.0

    return Structure(lattice, species, coords)


def make_synthetic_dataset(n=1500):
    """Fallback synthetic dataset obeying physical thermodynamic ground states and realistic densities."""
    rows = []
    idx = 0
    # Include pure elemental references and ground-state compounds multiple times
    for system in REFERENCE_SYSTEMS:
        for formula, fe, density, bg, ns in system["phases"]:
            struct = _make_structure_for_formula(formula, density, ns)
            e_hull = 0.0
            rows.append({
                "material_id": f"syn-ref-{idx}",
                "formula": struct.composition.reduced_formula,
                "structure": struct,
                "formation_energy_per_atom": fe,
                "band_gap": bg,
                "density": float(struct.density),
                "energy_above_hull": e_hull,
                "nsites": len(struct),
                "system": system["name"],
            })
            idx += 1

    # Populate realistic variations within each chemical system
    while len(rows) < n:
        system = random.choice(REFERENCE_SYSTEMS)
        base_formula, base_fe, base_density, base_bg, base_ns = random.choice(system["phases"])
        comp = Composition(base_formula)
        if len(comp.elements) == 1:
            fe = 0.0
            e_hull = 0.0
        else:
            e_hull = round(max(0.0, random.gauss(0.015, 0.01)), 4)
            fe = round(base_fe + e_hull, 4)

        density = round(max(1.5, base_density + random.gauss(0.0, 0.1)), 3)
        bg = round(max(0.0, base_bg + random.gauss(0.0, 0.1)), 2)
        struct = _make_structure_for_formula(base_formula, density, base_ns)

        rows.append({
            "material_id": f"synthetic-{idx}",
            "formula": struct.composition.reduced_formula,
            "structure": struct,
            "formation_energy_per_atom": fe,
            "band_gap": bg,
            "density": float(struct.density),
            "energy_above_hull": e_hull,
            "nsites": len(struct),
            "system": system["name"],
        })
        idx += 1

    return pd.DataFrame(rows)


def preprocess(df):
    """Normalize properties and filter thermodynamic stability."""
    df = df.dropna(subset=["structure", "formation_energy_per_atom", "density"]).copy()
    df = df[df["energy_above_hull"] < 0.05].copy()
    for col in ["formation_energy_per_atom", "density", "band_gap"]:
        mu, sigma = df[col].mean(), df[col].std() + 1e-9
        df[col + "_norm"] = (df[col] - mu) / sigma
    df = df.reset_index(drop=True)
    return df


def get_dataset(api_key=None, n_samples=3000):
    """Unified entry point for loading dataset (MP API or synthetic fallback)."""
    env_api_key = api_key or os.environ.get("MP_API_KEY")
    if env_api_key:
        try:
            raw_df = fetch_materials_project_data(env_api_key, n_samples=n_samples)
            return preprocess(raw_df)
        except Exception as e:
            print(f"Materials Project API fetch failed ({e}). Falling back to synthetic dataset.")
    
    raw_df = make_synthetic_dataset(n=min(n_samples, 1500))
    return preprocess(raw_df)

# =========================================================
# 2. Generative Engine — VAE + Dataset Structure Grounding
# =========================================================

class CrystalVAE(nn.Module):
    """Composition + lattice VAE conditioned on target properties."""
    def __init__(self, feat_dim, cond_dim, latent_dim=32, hidden=128):
        super().__init__()
        self.enc = nn.Sequential(
            nn.Linear(feat_dim + cond_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
        )
        self.mu = nn.Linear(hidden, latent_dim)
        self.logvar = nn.Linear(hidden, latent_dim)
        self.dec = nn.Sequential(
            nn.Linear(latent_dim + cond_dim, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, feat_dim),
        )

    def encode(self, x, c):
        h = self.enc(torch.cat([x, c], dim=-1))
        return self.mu(h), self.logvar(h)

    def reparameterize(self, mu, logvar):
        std = torch.exp(0.5 * logvar)
        return mu + std * torch.randn_like(std)

    def decode(self, z, c):
        return self.dec(torch.cat([z, c], dim=-1))

    def forward(self, x, c):
        mu, logvar = self.encode(x, c)
        z = self.reparameterize(mu, logvar)
        recon = self.decode(z, c)
        return recon, mu, logvar


def vae_loss(recon, x, mu, logvar, beta=0.01):
    recon_loss = F.mse_loss(recon, x, reduction="mean")
    kld = -0.5 * torch.mean(1 + logvar - mu.pow(2) - logvar.exp())
    return recon_loss + beta * kld, recon_loss, kld


def struct_to_vector(struct, element_vocab, el2idx):
    """Feature vector: composition fractions + lattice parameters (a,b,c,alpha,beta,gamma)."""
    comp_vec = np.zeros(len(element_vocab))
    comp = struct.composition.fractional_composition
    for el, frac in comp.items():
        if el.symbol in el2idx:
            comp_vec[el2idx[el.symbol]] = frac
    lat = struct.lattice
    lat_vec = np.array([lat.a, lat.b, lat.c, lat.alpha, lat.beta, lat.gamma]) / np.array([10, 10, 10, 180, 180, 180])
    return np.concatenate([comp_vec, lat_vec]).astype(np.float32)


def find_prototype_structure(dataset_df, target_species, target_density, target_fe):
    """
    Finds a structurally compatible crystal prototype from dataset_df.
    Evaluates candidates scored by composition overlap, density, and formation energy.
    """
    target_set = set(target_species)
    best_struct = None
    best_score = -999.0

    # Search through dataset (sample up to 300 rows for speed and coverage)
    sample_df = dataset_df if len(dataset_df) <= 300 else dataset_df.sample(300, random_state=SEED)

    for _, row in sample_df.iterrows():
        try:
            struct = row["structure"]
            proto_elements = {el.symbol for el in struct.composition.elements}
            intersection = proto_elements.intersection(target_set)
            if not intersection:
                continue

            union = proto_elements.union(target_set)
            jaccard = len(intersection) / len(union)

            density_diff = abs(row.get("density", 5.0) - target_density)
            fe_diff = abs(row.get("formation_energy_per_atom", -1.5) - target_fe)

            score = jaccard * 3.0 - 0.05 * density_diff - 0.05 * fe_diff
            if score > best_score:
                best_score = score
                best_struct = struct
        except Exception:
            continue

    return best_struct


def vector_to_structure_grounded(vec, element_vocab, dataset_df, target_condition):
    """
    Decodes VAE feature vector into a physically grounded pymatgen Structure.
    Aligns composition to coherent chemical systems and scales prototype lattices to target density.
    """
    n_elements = len(element_vocab)
    el2idx = {e: i for i, e in enumerate(element_vocab)}
    comp_part = np.clip(vec[:n_elements], 0, None)
    if comp_part.sum() <= 0:
        return None
    comp_part = comp_part / comp_part.sum()

    # Find the chemical system with the highest activation
    best_sys = None
    best_sys_score = -1.0
    for sys_info in REFERENCE_SYSTEMS:
        score = sum(comp_part[el2idx[el]] for el in sys_info["elements"] if el in el2idx)
        if score > best_sys_score:
            best_sys_score = score
            best_sys = sys_info

    if best_sys:
        sys_elements = [el for el in best_sys["elements"] if el in el2idx]
        sorted_elements = sorted(sys_elements, key=lambda el: comp_part[el2idx[el]], reverse=True)
        target_species = sorted_elements[:3]
        if len(target_species) < 2 and len(sorted_elements) >= 2:
            target_species = sorted_elements[:2]
    else:
        top_idx = np.argsort(comp_part)[::-1][:3]
        target_species = [element_vocab[i] for i in top_idx if comp_part[i] > 0.05]
        if not target_species:
            target_species = [element_vocab[top_idx[0]]]

    target_density = float(target_condition.get("density", 5.0))
    target_fe = float(target_condition.get("formation_energy_per_atom", -1.5))

    proto_struct = find_prototype_structure(dataset_df, target_species, target_density, target_fe)

    try:
        if proto_struct is not None:
            # Scale prototype lattice volume to match target density
            proto_density = max(0.5, float(proto_struct.density))
            scale_factor = max(0.6, min(1.6, (proto_density / max(0.5, target_density)) ** (1 / 3)))
            new_lattice = Lattice(proto_struct.lattice.matrix * scale_factor)

            n_sites = proto_struct.num_sites
            site_species = [target_species[i % len(target_species)] for i in range(n_sites)]
            frac_coords = proto_struct.frac_coords.copy()
            jitter = np.random.normal(0, 0.003, size=frac_coords.shape)
            frac_coords = (frac_coords + jitter) % 1.0
            return Structure(new_lattice, site_species, frac_coords)
        else:
            # Standard crystallographic template scaled to target density
            n_sites = max(2, min(8, len(target_species) * 2))
            site_species = [target_species[i % len(target_species)] for i in range(n_sites)]
            avg_mass = sum(Composition(s).weight for s in site_species)
            volume = avg_mass / (max(0.5, target_density) * 0.602214)
            a = max(2.5, min(20.0, float(volume ** (1 / 3))))
            lattice = Lattice.cubic(a)
            if n_sites == 2:
                coords = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.5]])
            elif n_sites == 4:
                coords = np.array([[0.0, 0.0, 0.0], [0.5, 0.5, 0.0], [0.5, 0.0, 0.5], [0.0, 0.5, 0.5]])
            else:
                coords = np.linspace(0.05, 0.95, n_sites * 3).reshape(n_sites, 3) % 1.0
            return Structure(lattice, site_species, coords)
    except Exception:
        return None


def validate_generated_structure(struct, min_dist=0.7):
    """
    Checks physical plausibility of a generated pymatgen Structure object.
    Filters out invalid geometry, absurd lattice dimensions, and atomic collisions (< 0.7 Å).
    """
    if struct is None:
        return False, "Structure generation returned None"
    try:
        if struct.num_sites < 2:
            return False, "Structure has fewer than 2 sites"
        
        lat = struct.lattice
        if not (1.5 <= lat.a <= 30.0 and 1.5 <= lat.b <= 30.0 and 1.5 <= lat.c <= 30.0):
            return False, f"Unphysical lattice dimensions: a={lat.a:.1f}, b={lat.b:.1f}, c={lat.c:.1f}"
        
        if not (30.0 <= lat.alpha <= 150.0 and 30.0 <= lat.beta <= 150.0 and 30.0 <= lat.gamma <= 150.0):
            return False, f"Unphysical lattice angles: alpha={lat.alpha:.1f}, beta={lat.beta:.1f}, gamma={lat.gamma:.1f}"
            
        if lat.volume <= 1.0 or lat.volume > 5000.0:
            return False, f"Unphysical unit cell volume: {lat.volume:.1f} A^3"

        dist_matrix = struct.distance_matrix
        np.fill_diagonal(dist_matrix, np.inf)
        min_d = np.min(dist_matrix)
        if min_d < min_dist:
            return False, f"Atomic collision detected: min distance = {min_d:.2f} A (< {min_dist} A)"

        return True, "Valid"
    except Exception as e:
        return False, f"Validation exception: {str(e)}"


def generate_candidates(dataset_df, models, target_condition, n_candidates=100, diagnostics=None):
    """
    Generate candidate pymatgen Structures using Dataset Prototype Grounding.
    Updates exact diagnostic accounting counters.
    """
    vae_model = models["vae_model"]
    element_vocab = models["element_vocab"]

    mu_fe, sd_fe = dataset_df["formation_energy_per_atom"].mean(), dataset_df["formation_energy_per_atom"].std()
    mu_bg, sd_bg = dataset_df["band_gap"].mean(), dataset_df["band_gap"].std()
    mu_de, sd_de = dataset_df["density"].mean(), dataset_df["density"].std()

    c = np.array([
        (target_condition.get("formation_energy_per_atom", mu_fe) - mu_fe) / (sd_fe + 1e-9),
        (target_condition.get("band_gap", mu_bg) - mu_bg) / (sd_bg + 1e-9),
        (target_condition.get("density", mu_de) - mu_de) / (sd_de + 1e-9),
    ], dtype=np.float32)

    c_t = torch.tensor(np.tile(c, (n_candidates, 1)), device=device)
    z = torch.randn(n_candidates, vae_model.mu.out_features, device=device)
    with torch.no_grad():
        decoded = vae_model.decode(z, c_t).cpu().numpy()

    candidates = []

    for vec in decoded:
        struct = vector_to_structure_grounded(vec, element_vocab, dataset_df, target_condition)
        is_valid, reason = validate_generated_structure(struct)
        if is_valid:
            candidates.append((struct, vec))
        else:
            if diagnostics is not None:
                diagnostics["geometry_rejected"] += 1
                if len(diagnostics["errors"]["geometry"]) < 5:
                    diagnostics["errors"]["geometry"].append(reason)

    if diagnostics is not None:
        diagnostics["generated"] = n_candidates
        diagnostics["geometry_valid"] = len(candidates)

    return candidates

# =========================================================
# 3. Model Loading & Reference Fitting (Consistently in eV/atom)
# =========================================================

def fit_energy_reference_frame(df, predict_fn_per_atom, element_vocab, el2idx, n_fit=200, seed=SEED):
    """
    Fits per-element reference energies in eV/atom via least squares:
    raw_energy_per_atom - target_formation_energy_per_atom ~= sum_i (x_i * reference_i)
    where x_i is the fractional composition of element i (sum_i x_i = 1.0).
    """
    sample = df.sample(n=min(n_fit, len(df)), random_state=seed)
    rows = []
    targets = []
    failed = 0

    for _, row in sample.iterrows():
        try:
            struct = row["structure"]
            e_raw_per_atom = predict_fn_per_atom(struct)
            if e_raw_per_atom is None or np.isnan(e_raw_per_atom):
                failed += 1
                continue
            
            comp_vec = np.zeros(len(element_vocab))
            comp = struct.composition.fractional_composition
            for el, frac in comp.items():
                if el.symbol in el2idx:
                    comp_vec[el2idx[el.symbol]] = frac

            rows.append(comp_vec)
            targets.append(e_raw_per_atom - float(row["formation_energy_per_atom"]))
        except Exception:
            failed += 1
            continue

    if not rows:
        return {el: 0.0 for el in element_vocab}

    X = np.asarray(rows, dtype=float)
    y = np.asarray(targets, dtype=float)
    coeffs, *_ = np.linalg.lstsq(X, y, rcond=None)
    return dict(zip(element_vocab, coeffs))


def calculate_regression_metrics(y_true, y_pred):
    """
    Calculates R^2 score, MAE, RMSE, Mean Bias Error, Max Absolute Error, and N_test.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = ~np.isnan(y_true) & ~np.isnan(y_pred)
    y_t = y_true[mask]
    y_p = y_pred[mask]
    if len(y_t) == 0:
        return None
    r2 = float(r2_score(y_t, y_p))
    mae = float(np.mean(np.abs(y_p - y_t)))
    rmse = float(np.sqrt(np.mean((y_p - y_t) ** 2)))
    mean_bias = float(np.mean(y_p - y_t))
    max_abs_err = float(np.max(np.abs(y_p - y_t)))
    return {
        "r2": r2,
        "mae": mae,
        "rmse": rmse,
        "mean_bias": mean_bias,
        "max_abs_err": max_abs_err,
        "n_test": int(len(y_t)),
        "y_true": y_t.tolist(),
        "y_pred": y_p.tolist(),
        "errors": (y_p - y_t).tolist()
    }


def evaluate_all_models_on_test_set(test_df, models, max_test_samples=200):
    """
    Evaluates XGBoost, CHGNet, and M3GNet on the SAME held-out test structures.
    Calculates R^2, MAE (eV/atom), RMSE (eV/atom), and prediction error distribution.
    """
    sample_df = test_df.sample(n=min(max_test_samples, len(test_df)), random_state=SEED) if len(test_df) > max_test_samples else test_df
    eval_results = {}

    # 1. XGBoost Evaluation
    if models.get("xgb_model") and models.get("magpie_featurizer"):
        try:
            comps = sample_df["structure"].apply(lambda s: s.composition)
            feats = comps.apply(lambda c: models["magpie_featurizer"].featurize(c))
            X_test = pd.DataFrame(feats.tolist(), columns=models["magpie_featurizer"].feature_labels())
            y_pred_xgb = models["xgb_model"].predict(X_test)
            y_true = sample_df["formation_energy_per_atom"].values
            eval_results["xgboost"] = calculate_regression_metrics(y_true, y_pred_xgb)
        except Exception as e:
            print(f"XGBoost evaluation exception: {e}")
            eval_results["xgboost"] = None
    else:
        eval_results["xgboost"] = None

    # 2. CHGNet Evaluation
    if models.get("chgnet_model"):
        try:
            y_true_chg, y_pred_chg = [], []
            for _, row in sample_df.iterrows():
                pred = chgnet_predict_formation_energy(row["structure"], models)
                if pred is not None and not np.isnan(pred):
                    y_true_chg.append(float(row["formation_energy_per_atom"]))
                    y_pred_chg.append(float(pred))
            eval_results["chgnet"] = calculate_regression_metrics(y_true_chg, y_pred_chg)
        except Exception as e:
            print(f"CHGNet evaluation exception: {e}")
            eval_results["chgnet"] = None
    else:
        eval_results["chgnet"] = None

    # 3. M3GNet Evaluation
    if models.get("m3gnet_calc"):
        try:
            y_true_m3g, y_pred_m3g = [], []
            for _, row in sample_df.iterrows():
                pred = m3gnet_predict_formation_energy(row["structure"], models)
                if pred is not None and not np.isnan(pred):
                    y_true_m3g.append(float(row["formation_energy_per_atom"]))
                    y_pred_m3g.append(float(pred))
            eval_results["m3gnet"] = calculate_regression_metrics(y_true_m3g, y_pred_m3g)
        except Exception as e:
            print(f"M3GNet evaluation exception: {e}")
            eval_results["m3gnet"] = None
    else:
        eval_results["m3gnet"] = None

    return eval_results


def load_all_models(dataset_df):
    """
    Loads CHGNet, M3GNet (PESCalculator API), XGBoost+Magpie, and trains CrystalVAE.
    Fits elemental reference energy corrections strictly in eV/atom on train_df (80/20 split).
    """
    # 80/20 Held-out Train/Test Split
    train_df, test_df = train_test_split(dataset_df, test_size=0.2, random_state=SEED)

    element_vocab = sorted({el.symbol for s in dataset_df["structure"] for el in s.composition.elements})
    if not element_vocab:
        element_vocab = DEFAULT_ELEMENT_VOCAB
    el2idx = {e: i for i, e in enumerate(element_vocab)}

    X_list, Y_list = [], []
    for _, row in dataset_df.iterrows():
        try:
            v = struct_to_vector(row["structure"], element_vocab, el2idx)
            X_list.append(v)
            Y_list.append([row["formation_energy_per_atom_norm"], row["band_gap_norm"], row["density_norm"]])
        except Exception:
            continue

    X = np.stack(X_list)
    Y_cond = np.array(Y_list, dtype=np.float32)

    feat_dim = X.shape[1]
    cond_dim = Y_cond.shape[1]
    vae_model = CrystalVAE(feat_dim, cond_dim).to(device)
    opt = torch.optim.Adam(vae_model.parameters(), lr=1e-3)

    X_t = torch.tensor(X, device=device)
    C_t = torch.tensor(Y_cond, device=device)
    epochs = 40
    batch_size = 128
    n = X_t.shape[0]

    vae_history = {
        "reconstruction_loss": [],
        "kl_loss": [],
        "total_loss": [],
        "epochs": list(range(1, epochs + 1))
    }

    vae_model.train()
    for epoch in range(epochs):
        perm = torch.randperm(n, device=device)
        ep_loss, ep_recon, ep_kld = 0.0, 0.0, 0.0
        n_batches = 0
        for i in range(0, n, batch_size):
            idx = perm[i:i + batch_size]
            xb, cb = X_t[idx], C_t[idx]
            recon, mu, logvar = vae_model(xb, cb)
            loss, r_loss, k_loss = vae_loss(recon, xb, mu, logvar)
            opt.zero_grad()
            loss.backward()
            opt.step()
            ep_loss += float(loss.item())
            ep_recon += float(r_loss.item())
            ep_kld += float(k_loss.item())
            n_batches += 1
        vae_history["total_loss"].append(ep_loss / max(1, n_batches))
        vae_history["reconstruction_loss"].append(ep_recon / max(1, n_batches))
        vae_history["kl_loss"].append(ep_kld / max(1, n_batches))
    vae_model.eval()

    chgnet_model = None
    chgnet_optimizer = None
    try:
        from chgnet.model import CHGNet
        from chgnet.model.dynamics import StructOptimizer
        chgnet_model = CHGNet.load()
        chgnet_optimizer = StructOptimizer(model=chgnet_model)
    except Exception as e:
        print(f"CHGNet could not be loaded: {e}")

    m3gnet_calc = None
    _M3GNET_CANDIDATES = [
        "M3GNet-PES-MatPES-PBE-2025.2",
        "M3GNet-PES-2021.2.8-PBE-DIRECT-COMPAT",
        "M3GNet-PES-2021.2.8-PBE",
        "M3GNet-PES-2021.2.8",
    ]
    try:
        import matgl
        from matgl.ext.ase import PESCalculator
        _m3g_loaded = False
        for _m3g_name in _M3GNET_CANDIDATES:
            try:
                m3gnet_model = matgl.load_model(_m3g_name)
                m3gnet_calc = PESCalculator(potential=m3gnet_model)
                print(f"M3GNet loaded: {_m3g_name}")
                _m3g_loaded = True
                break
            except Exception as _m3g_err:
                print(f"M3GNet model '{_m3g_name}' not available: {_m3g_err}")
        if not _m3g_loaded:
            print("M3GNet could not be loaded: no pretrained model was accessible.")
    except ImportError as e:
        print(f"M3GNet could not be loaded (import error): {e}")

    xgb_model = None
    magpie_featurizer = None
    try:
        from matminer.featurizers.composition import ElementProperty
        from xgboost import XGBRegressor
        magpie_featurizer = ElementProperty.from_preset("magpie")
        train_comps = train_df["structure"].apply(lambda s: s.composition)
        train_feats = train_comps.apply(lambda c: magpie_featurizer.featurize(c))
        train_X = pd.DataFrame(train_feats.tolist(), columns=magpie_featurizer.feature_labels())
        train_y = train_df["formation_energy_per_atom"].values

        xgb_model = XGBRegressor(n_estimators=150, max_depth=6, learning_rate=0.05, random_state=SEED)
        xgb_model.fit(train_X, train_y)
    except Exception as e:
        print(f"XGBoost/Magpie could not be trained: {e}")

    # Helper raw functions returning energy per atom (eV/atom)
    def _predict_chgnet_raw_per_atom(s):
        if not chgnet_model:
            return None
        try:
            total_e = float(chgnet_model.predict_structure(s)["e"])
            return total_e / len(s)
        except Exception:
            return None

    def _predict_m3gnet_raw_per_atom(s):
        if not m3gnet_calc:
            return None
        try:
            from pymatgen.io.ase import AseAtomsAdaptor
            atoms = AseAtomsAdaptor.get_atoms(s)
            atoms.calc = m3gnet_calc
            total_e = float(atoms.get_potential_energy())
            return total_e / len(atoms)
        except Exception:
            return None

    # Reference energies fitted STRICTLY on train_df only (preventing test set leakage)
    chgnet_refs = fit_energy_reference_frame(train_df, _predict_chgnet_raw_per_atom, element_vocab, el2idx) if chgnet_model else {}
    m3gnet_refs = fit_energy_reference_frame(train_df, _predict_m3gnet_raw_per_atom, element_vocab, el2idx) if m3gnet_calc else {}

    models_dict = {
        "vae_model": vae_model,
        "element_vocab": element_vocab,
        "el2idx": el2idx,
        "chgnet_model": chgnet_model,
        "chgnet_optimizer": chgnet_optimizer,
        "m3gnet_calc": m3gnet_calc,
        "xgb_model": xgb_model,
        "magpie_featurizer": magpie_featurizer,
        "chgnet_refs": chgnet_refs,
        "m3gnet_refs": m3gnet_refs,
        "model_availability": {
            "chgnet": chgnet_model is not None,
            "m3gnet": m3gnet_calc is not None,
            "xgboost": xgb_model is not None,
        },
        "vae_history": vae_history
    }

    eval_results = evaluate_all_models_on_test_set(test_df, models_dict, max_test_samples=200)
    models_dict["eval_results"] = eval_results

    return models_dict

# =========================================================
# 4. Property Prediction & Thermodynamic Filter
# =========================================================

def relax_candidate_structure(struct, models, steps=10):
    """Optionally relaxes candidate atomic positions using CHGNet StructOptimizer."""
    opt = models.get("chgnet_optimizer")
    if not opt or struct is None:
        return struct
    try:
        res = opt.relax(struct, steps=steps, verbose=False)
        return res["final_structure"]
    except Exception:
        return struct


def chgnet_predict_formation_energy(struct, models):
    """
    Predicts formation energy in eV/atom:
    chgnet_raw_per_atom - sum(element_fraction * elemental_reference_energy)
    """
    if not models.get("chgnet_model"):
        return None
    try:
        raw_total_e = float(models["chgnet_model"].predict_structure(struct)["e"])
        raw_e_per_atom = raw_total_e / len(struct)
        comp = struct.composition.fractional_composition
        ref = sum(frac * models["chgnet_refs"].get(el.symbol, 0.0) for el, frac in comp.items())
        return float(raw_e_per_atom - ref)
    except Exception:
        return None


def m3gnet_predict_formation_energy(struct, models):
    """
    Predicts formation energy in eV/atom:
    m3gnet_raw_per_atom - sum(element_fraction * elemental_reference_energy)
    """
    if not models.get("m3gnet_calc"):
        return None
    try:
        from pymatgen.io.ase import AseAtomsAdaptor
        atoms = AseAtomsAdaptor.get_atoms(struct)
        atoms.calc = models["m3gnet_calc"]
        raw_total_e = float(atoms.get_potential_energy())
        raw_e_per_atom = raw_total_e / len(atoms)
        comp = struct.composition.fractional_composition
        ref = sum(frac * models["m3gnet_refs"].get(el.symbol, 0.0) for el, frac in comp.items())
        return float(raw_e_per_atom - ref)
    except Exception:
        return None


def xgboost_predict_formation_energy(struct, models):
    """Predicts formation energy directly in eV/atom using Magpie features."""
    if not models.get("xgb_model") or not models.get("magpie_featurizer"):
        return None
    try:
        feats = np.array(models["magpie_featurizer"].featurize(struct.composition)).reshape(1, -1)
        feats_df = pd.DataFrame(feats, columns=models["magpie_featurizer"].feature_labels())
        return float(models["xgb_model"].predict(feats_df)[0])
    except Exception:
        return None


@lru_cache(maxsize=128)
def _build_phase_diagram_cached(elements_tuple, entries_json_str):
    """Cached building of PhaseDiagram for a specific chemical system."""
    entries_raw = json.loads(entries_json_str)
    entries = []
    for e in entries_raw:
        entries.append(ComputedEntry(Composition(e["comp"]), float(e["energy"]), entry_id=e["id"]))
    return PhaseDiagram(entries)


def approximate_energy_above_hull(dataset_df, struct, candidate_formation_energy_per_atom):
    """
    Calculates E_hull in eV/atom using candidate's OWN predicted formation energy.
    Constructs phase diagram entries with total energy = formation_energy_per_atom * num_atoms.
    Returns: (e_hull, error_msg)
    """
    try:
        if candidate_formation_energy_per_atom is None or np.isnan(candidate_formation_energy_per_atom):
            return None, "Candidate formation energy is None or NaN"

        elements = tuple(sorted({el.symbol for el in struct.composition.elements}))
        if not elements:
            return None, "Structure composition has no elements"

        element_set = set(elements)
        entries_list = []

        # Add pure elemental reference states (0.0 eV energy)
        for el in elements:
            entries_list.append({"comp": el, "energy": 0.0, "id": f"element-{el}"})

        # Add relevant dataset entries for sub-components
        for _, row in dataset_df.iterrows():
            try:
                comp = row["structure"].composition
                comp_elements = {el.symbol for el in comp.elements}
                fe = row.get("formation_energy_per_atom")
                if comp_elements.issubset(element_set) and fe is not None and not np.isnan(fe):
                    if len(comp_elements) == 1 and fe < 0:
                        fe = 0.0
                    total_entry_energy = float(fe) * float(comp.num_atoms)
                    entries_list.append({"comp": comp.formula, "energy": total_entry_energy, "id": str(row["material_id"])})
            except Exception:
                continue

        entries_json = json.dumps(entries_list, sort_keys=True)
        pd_obj = _build_phase_diagram_cached(elements, entries_json)

        # Candidate entry with TOTAL energy = formation_energy_per_atom * num_atoms
        candidate_num_atoms = float(struct.composition.num_atoms)
        candidate_total_energy = float(candidate_formation_energy_per_atom) * candidate_num_atoms
        candidate_entry = ComputedEntry(struct.composition, candidate_total_energy)

        try:
            e_hull = float(pd_obj.get_e_above_hull(candidate_entry))
        except Exception as eh_err:
            err_str = str(eh_err)
            if "(e_h:" in err_str:
                try:
                    val = float(err_str.split("(e_h:")[1].split(")")[0].strip())
                    if val <= 0:
                        return 0.0, None
                except Exception:
                    pass
            pd_with = PhaseDiagram([ComputedEntry(Composition(e["comp"]), float(e["energy"]), entry_id=e["id"]) for e in entries_list] + [candidate_entry])
            e_hull = float(pd_with.get_e_above_hull(candidate_entry))
        return e_hull, None
    except Exception as e:
        return None, f"PhaseDiagram Exception: {str(e)}"


def thermodynamic_filter(dataset_df, candidates, models, threshold=0.05, relax=False, diagnostics=None):
    """
    Filter candidate structures by E_hull < threshold.
    Uses candidate's predicted formation energy. Enforces exact diagnostic accounting.
    """
    kept = []

    for struct, vec in candidates:
        if relax:
            struct = relax_candidate_structure(struct, models, steps=10)

        fe = chgnet_predict_formation_energy(struct, models)
        if fe is None:
            fe = m3gnet_predict_formation_energy(struct, models)
        if fe is None:
            fe = xgboost_predict_formation_energy(struct, models)

        if fe is None:
            if diagnostics is not None:
                diagnostics["e_hull_failed"] += 1
                if len(diagnostics["errors"]["thermodynamic"]) < 5:
                    diagnostics["errors"]["thermodynamic"].append("Property prediction models returned None")
            continue

        e_hull, err_msg = approximate_energy_above_hull(dataset_df, struct, fe)
        if e_hull is None:
            if diagnostics is not None:
                diagnostics["e_hull_failed"] += 1
                if len(diagnostics["errors"]["thermodynamic"]) < 5:
                    diagnostics["errors"]["thermodynamic"].append(f"{struct.composition.reduced_formula}: {err_msg}")
            continue

        if e_hull < threshold:
            kept.append((struct, vec, e_hull, fe))
            if diagnostics is not None:
                diagnostics["e_hull_passed"] += 1
        else:
            if diagnostics is not None:
                diagnostics["e_hull_rejected"] += 1
                if len(diagnostics["errors"]["thermodynamic"]) < 5:
                    diagnostics["errors"]["thermodynamic"].append(f"{struct.composition.reduced_formula}: E_hull {e_hull:.4f} eV/atom >= {threshold:.2f} eV/atom (fe={fe:.4f})")

    if diagnostics is not None:
        diagnostics["thermodynamic_evaluated"] = diagnostics["geometry_valid"] - diagnostics["e_hull_failed"]

    return kept

# =========================================================
# 5. Ensemble Jury Consensus
# =========================================================

def ensemble_consensus(struct, models, tau=0.15):
    """
    Runs available constituent models and evaluates prediction spread consensus.
    Returns: (consensus_pass, mean_prediction, spread, per_model_preds, status_message)
    """
    preds = {
        "chgnet": chgnet_predict_formation_energy(struct, models),
        "m3gnet": m3gnet_predict_formation_energy(struct, models),
        "xgboost": xgboost_predict_formation_energy(struct, models),
    }

    valid = {k: v for k, v in preds.items() if v is not None}
    if len(valid) == 0:
        return False, None, None, preds, "No model predictions available"

    vals = np.array(list(valid.values()))
    if len(vals) == 1:
        return True, float(vals[0]), 0.0, preds, "Passed (single model available)"

    span = float(vals.max() - vals.min())
    scale = max(abs(float(vals.max())), abs(float(vals.min())), 1e-6)
    normalized_spread = span / scale
    consensus_pass = bool(normalized_spread <= tau)
    msg = "Passed consensus" if consensus_pass else f"Spread {normalized_spread:.3f} > tau {tau:.3f}"

    return consensus_pass, float(vals.mean()), float(normalized_spread), preds, msg


def run_ensemble_jury(filtered_candidates, models, tau=0.15, diagnostics=None):
    """Runs ensemble jury evaluation across thermodynamic-filter survivors."""
    results = []

    if diagnostics is not None:
        diagnostics["jury_evaluated"] = len(filtered_candidates)

    for struct, vec, e_hull, thermo_fe in filtered_candidates:
        consensus, mean_pred, spread, preds, msg = ensemble_consensus(struct, models, tau=tau)
        
        detail = {
            "formula": struct.composition.reduced_formula,
            "e_hull": e_hull,
            "thermo_fe": thermo_fe,
            "mean_pred": mean_pred,
            "spread": spread,
            "model_preds": preds,
            "consensus": consensus,
            "status": msg
        }
        if diagnostics is not None:
            diagnostics["candidate_details"].append(detail)

        if consensus:
            results.append({
                "structure": struct,
                "e_hull": e_hull,
                "thermo_filter_formation_energy": thermo_fe,
                "predicted_formation_energy": mean_pred,
                "consensus_spread": spread,
                "model_predictions": preds,
            })
            if diagnostics is not None:
                diagnostics["jury_passed"] += 1
        else:
            if diagnostics is not None:
                diagnostics["jury_rejected"] += 1
                if len(diagnostics["errors"]["jury"]) < 5:
                    diagnostics["errors"]["jury"].append(f"{struct.composition.reduced_formula}: {msg}")

    if diagnostics is not None:
        diagnostics["final_validated"] = len(results)

    return results

# =========================================================
# 6. Complete MatChain Pipeline API
# =========================================================

def matchain_pipeline(target_condition, n_candidates=100, tau=0.15, top_k=5, models=None, dataset_df=None, api_key=None, relax=False, verbose=False):
    """
    Main MatChain Inverse Design Pipeline.
    Coordinates generation -> thermodynamic filter -> ensemble jury consensus.
    Enforces strict mathematical accounting laws across diagnostics.
    """
    t0 = time.time()

    diagnostics = {
        "generated": 0,
        "geometry_valid": 0,
        "geometry_rejected": 0,
        "thermodynamic_evaluated": 0,
        "e_hull_passed": 0,
        "e_hull_rejected": 0,
        "e_hull_failed": 0,
        "jury_evaluated": 0,
        "jury_passed": 0,
        "jury_rejected": 0,
        "final_validated": 0,
        "model_availability": {},
        "errors": {
            "geometry": [],
            "thermodynamic": [],
            "jury": []
        },
        "candidate_details": [],
        "target_matching": {},
        "ensemble_stats": {}
    }

    if dataset_df is None:
        dataset_df = get_dataset(api_key=api_key)

    if models is None:
        models = load_all_models(dataset_df)

    diagnostics["model_availability"] = models.get("model_availability", {})

    # Stage 1: Candidate Generation & Geometry Validation
    candidates = generate_candidates(dataset_df, models, target_condition, n_candidates=n_candidates, diagnostics=diagnostics)
    if verbose:
        print(f"[1/3] Generated {diagnostics['generated']} | Geometry Valid: {diagnostics['geometry_valid']} | Rejected: {diagnostics['geometry_rejected']}")

    # Calculate Target Property Matching Statistics
    if candidates:
        valid_structs = [c[0] for c in candidates]
        fe_preds = [chgnet_predict_formation_energy(s, models) or xgboost_predict_formation_energy(s, models) for s in valid_structs]
        fe_preds = [f for f in fe_preds if f is not None]
        densities = [float(s.density) for s in valid_structs]

        target_fe = target_condition.get("formation_energy_per_atom", -1.5)
        target_bg = target_condition.get("band_gap", 0.0)
        target_de = target_condition.get("density", 5.0)

        mean_gen_fe = float(np.mean(fe_preds)) if fe_preds else None
        mae_fe = float(np.mean(np.abs(np.array(fe_preds) - target_fe))) if fe_preds else None

        mean_gen_de = float(np.mean(densities)) if densities else None
        mae_de = float(np.mean(np.abs(np.array(densities) - target_de))) if densities else None

        diagnostics["target_matching"] = {
            "formation_energy": {"target": target_fe, "mean_generated": mean_gen_fe, "mae": mae_fe},
            "density": {"target": target_de, "mean_generated": mean_gen_de, "mae": mae_de},
            "band_gap": {"target": target_bg, "mean_generated": None, "mae": None}
        }

    # Stage 2: Thermodynamic Filtering (E_hull < 0.05 eV/atom)
    filtered = thermodynamic_filter(dataset_df, candidates, models, threshold=0.05, relax=relax, diagnostics=diagnostics)
    if verbose:
        print(f"[2/3] Thermodynamic Evaluated: {diagnostics['thermodynamic_evaluated']} | Passed: {diagnostics['e_hull_passed']} | Rejected: {diagnostics['e_hull_rejected']} | Failures: {diagnostics['e_hull_failed']}")

    # Stage 3: Ensemble Jury Consensus
    validated = run_ensemble_jury(filtered, models, tau=tau, diagnostics=diagnostics)
    if verbose:
        print(f"[3/3] Jury Evaluated: {diagnostics['jury_evaluated']} | Passed: {diagnostics['jury_passed']} | Rejected: {diagnostics['jury_rejected']}")

    # Calculate Ensemble Jury Statistics
    spreads = [d["spread"] for d in diagnostics.get("candidate_details", []) if d.get("spread") is not None]
    diagnostics["ensemble_stats"] = {
        "jury_evaluated": diagnostics["jury_evaluated"],
        "jury_passed": diagnostics["jury_passed"],
        "consensus_rate_pct": float(diagnostics["jury_passed"] / diagnostics["jury_evaluated"] * 100) if diagnostics["jury_evaluated"] > 0 else 0.0,
        "avg_spread": float(np.mean(spreads)) if spreads else 0.0,
        "min_spread": float(np.min(spreads)) if spreads else 0.0,
        "max_spread": float(np.max(spreads)) if spreads else 0.0,
    }

    validated.sort(key=lambda r: r["consensus_spread"] if r["consensus_spread"] is not None else 999.0)
    elapsed = time.time() - t0

    return validated[:top_k], elapsed, diagnostics

# =========================================================
# 7. Simulated Blockchain & Ledger Provenance
# =========================================================

def _load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return default
    return default


def _save_json(path, data):
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Failed to write json to {path}: {e}")


def structure_payload(struct):
    """Deterministic serialization of atomic coordinates + lattice -> 'Digital DNA'."""
    return {
        "lattice": struct.lattice.matrix.tolist(),
        "species": [str(s) for s in struct.species],
        "frac_coords": struct.frac_coords.tolist(),
        "formula": struct.composition.reduced_formula,
    }


def sha256_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def store_off_chain(payload, ipfs_store):
    """Simulated IPFS: content-addressed by SHA-256 hash."""
    content_hash = sha256_hash(payload)
    ipfs_store[content_hash] = payload
    return content_hash


def record_on_chain(structure_hash, creator_id, metadata, ledger):
    """Simulated append-only chain entry."""
    block = {
        "block_index": len(ledger),
        "structure_hash": structure_hash,
        "creator_id": creator_id,
        "timestamp": time.time(),
        "metadata": metadata,
        "prev_hash": ledger[-1]["structure_hash"] if ledger else "genesis",
    }
    ledger.append(block)
    return block


def register_discovery(struct, creator_id, predicted_properties):
    ledger = _load_json(LEDGER_PATH, [])
    ipfs_store = _load_json(IPFS_STORE_PATH, {})

    payload = structure_payload(struct)
    content_hash = store_off_chain(payload, ipfs_store)
    block = record_on_chain(
        content_hash, creator_id,
        metadata={"formula": struct.composition.reduced_formula, **predicted_properties},
        ledger=ledger,
    )

    _save_json(LEDGER_PATH, ledger)
    _save_json(IPFS_STORE_PATH, ipfs_store)
    return block


def list_material(structure_hash, price, license_terms="research-use"):
    market = _load_json(MARKETPLACE_PATH, {})
    market[structure_hash] = {"price": price, "license": license_terms, "sold": False}
    _save_json(MARKETPLACE_PATH, market)
    return market[structure_hash]


def buy_material(structure_hash, buyer_id):
    market = _load_json(MARKETPLACE_PATH, {})
    ledger = _load_json(LEDGER_PATH, [])
    listing = market.get(structure_hash)
    if not listing or listing["sold"]:
        return {"status": "unavailable"}
    listing["sold"] = True
    listing["buyer"] = buyer_id
    _save_json(MARKETPLACE_PATH, market)
    for block in ledger:
        if block["structure_hash"] == structure_hash:
            return {"status": "success", "download_key": structure_hash, "metadata": block["metadata"]}
    return {"status": "error"}

# =========================================================
# 8. Main Script Execution Block (CLI & Reproducibility)
# =========================================================

if __name__ == "__main__":
    print("=================================================")
    print("Executing MatChain Pipeline Standalone CLI...")
    print("=================================================")

    print("Enter target property parameters (press Enter for default values):")
    try:
        fe_in = input("Target Formation Energy (eV/atom) [-1.5]: ").strip()
        target_fe = float(fe_in) if fe_in else -1.5

        bg_in = input("Target Band Gap (eV) [0.0]: ").strip()
        target_bg = float(bg_in) if bg_in else 0.0

        de_in = input("Target Density (g/cm3) [5.0]: ").strip()
        target_de = float(de_in) if de_in else 5.0

        cand_in = input("Number of Candidates to Sample [100]: ").strip()
        n_candidates = int(cand_in) if cand_in else 100
    except Exception as e:
        print(f"Invalid input ({e}), using default parameters.")
        target_fe, target_bg, target_de, n_candidates = -1.5, 0.0, 5.0, 100

    target_condition = {
        "formation_energy_per_atom": target_fe,
        "band_gap": target_bg,
        "density": target_de
    }

    dataset_df = get_dataset()
    print(f"\nLoaded dataset with {len(dataset_df)} stable entries.")

    models = load_all_models(dataset_df)
    print("Loaded models:", models["model_availability"])

    print(f"\nRunning pipeline for target: Formation Energy={target_fe} eV/atom, Band Gap={target_bg} eV, Density={target_de} g/cm3...")
    results, elapsed, diagnostics = matchain_pipeline(
        target_condition, n_candidates=n_candidates, tau=0.15, top_k=5, models=models, dataset_df=dataset_df, verbose=True
    )

    print(f"\nPipeline finished in {elapsed:.2f}s.")
    print("Diagnostics:", json.dumps({k: v for k, v in diagnostics.items() if k not in ("candidate_details",)}, indent=2))

    for i, r in enumerate(results):
        print(f"  Candidate #{i+1}: {r['structure'].composition.reduced_formula} | "
              f"E_hull: {r['e_hull']:.4f} | formation_E: {r['predicted_formation_energy']:.4f} | "
              f"spread: {r['consensus_spread']:.4f}")