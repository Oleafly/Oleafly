# 2025-05-02 Enzyme kinetics run 7

| Sample | Substrate (mM) | Rate (µM/s) | Note |
|:-------|---------------:|:-----------:|------|
| A1     | 0.5            | 1.21        | baseline |
| A2     | 1.0            | 2.05        | `pH\|7.4` buffer |
| A3     | 2.0            | 3.10        | P(A \| B) noted |

> [!example] Protocol
> 1. Warm the buffer to 37 °C.
> 2. Add substrate:
>    - 0.5 mM for A1
>    - 1.0 mM for A2
> 3. Read absorbance every 10 s.

The fit uses Michaelis–Menten:

$$
\begin{aligned}
v &= \frac{V_{max} [S]}{K_m + [S]} \\
K_m &\approx 1.4\ \text{mM}
\end{aligned}
$$

```python
rates = fit(df["S"], df["v"])  # $x$ here is code, not math
print(rates)
```

- [ ] Repeat A3 with fresh enzyme
- [x] Export plate reader data
  - [ ] Archive raw CSV

Inline check: $K_m < 2$ held for every replicate, and ==A2 looks odd==.
