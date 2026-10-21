# Generated benchmark tables

Generated 2026-10-21T05:11:32.185Z at commit `13b08ea` from 360 runs (3 presets × 3 noise levels × 10 seeds × 4 methods). Mean ± sample standard deviation.

## All presets and noise levels

| Method | Junction precision | Junction recall | Junction F1 | Position error (× diag) | Patch success | Boundary error (× diag) | Non-manifold edges | Fold-angle error (°) | Smooth-seam angle (°) | Repair ms |
|---|---|---|---|---|---|---|---|---|---|---|
| Unrepaired | 1.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.0044 ± 0.0024 | 0.000 ± 0.000 | n/a | 0.0 ± 0.0 | n/a | n/a | 1.5 ± 0.6 |
| Distance-only baseline | 0.965 ± 0.032 | 0.997 ± 0.013 | 0.981 ± 0.018 | 0.0028 ± 0.0015 | 0.742 ± 0.160 | 0.0010 ± 0.0005 | 0.0 ± 0.0 | 0.87 ± 0.57 | 2.56 ± 0.36 | 1.7 ± 0.8 |
| Intent-aware, no labels | 0.968 ± 0.033 | 0.976 ± 0.059 | 0.971 ± 0.038 | 0.0029 ± 0.0017 | 0.919 ± 0.169 | 0.0010 ± 0.0005 | 0.0 ± 0.0 | 0.81 ± 0.49 | 2.62 ± 0.37 | 2.0 ± 1.0 |
| Intent-aware + labels | 0.998 ± 0.007 | 0.976 ± 0.059 | 0.986 ± 0.033 | 0.0029 ± 0.0017 | 0.920 ± 0.167 | 0.0009 ± 0.0005 | 0.0 ± 0.0 | 0.80 ± 0.51 | 2.62 ± 0.37 | 2.0 ± 0.9 |

## Junction F1 by noise level

| Method | level 0.5× | level 1× | level 2× |
|---|---|---|---|
| Unrepaired | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 |
| Distance-only baseline | 0.982 ± 0.017 | 0.982 ± 0.017 | 0.977 ± 0.020 |
| Intent-aware, no labels | 0.982 ± 0.017 | 0.982 ± 0.017 | 0.948 ± 0.055 |
| Intent-aware + labels | 0.999 ± 0.003 | 0.999 ± 0.003 | 0.960 ± 0.048 |

## Patch success by noise level

| Method | level 0.5× | level 1× | level 2× |
|---|---|---|---|
| Unrepaired | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 |
| Distance-only baseline | 0.752 ± 0.161 | 0.752 ± 0.161 | 0.722 ± 0.163 |
| Intent-aware, no labels | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.758 ± 0.218 |
| Intent-aware + labels | 1.000 ± 0.000 | 1.000 ± 0.000 | 0.761 ± 0.214 |

## By preset (junction F1 / patch success / fold-angle error °)

| Preset | Unrepaired | Distance-only baseline | Intent-aware, no labels | Intent-aware + labels |
|---|---|---|---|---|
| Folded Pavilion | 0.000 / 0.000 / n/a | 0.959 / 0.693 / 0.86 | 0.949 / 0.933 / 0.84 | 0.985 / 0.933 / 0.81 |
| Curved Landscape Canopy | 0.000 / 0.000 / n/a | 0.998 / 0.772 / n/a | 0.988 / 0.933 / n/a | 0.988 / 0.933 / n/a |
| Fragmented Architectural Shell | 0.000 / 0.000 / n/a | 0.985 / 0.761 / 0.89 | 0.974 / 0.891 / 0.78 | 0.984 / 0.894 / 0.79 |

Solver convergence rate (runs with at least one patch): Unrepaired n/a; Distance-only baseline 100%; Intent-aware, no labels 100%; Intent-aware + labels 100%.
