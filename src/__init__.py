"""Memory-playground: 聊天 + Memory + Recall + 可视化."""

import os as _os

# PyTorch (sentence-transformers) 与 usearch 都使用 Intel OpenMP 并行。
# 多个 OpenMP 运行时同时初始化可能冲突。强制单线程规避。
# 必须在所有库导入之前设置，因此放在 src/__init__.py 最顶部。
for _omp_var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    _os.environ.setdefault(_omp_var, "1")
del _os, _omp_var
