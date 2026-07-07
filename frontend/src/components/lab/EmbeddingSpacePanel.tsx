"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  RiBubbleChartLine,
  RiSearchLine,
  RiCloseLine,
  RiEyeLine,
  RiEyeOffLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import ImageViewer from "@/components/ui/ImageViewer";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import type { EmbeddingCoordsResponse, EmbeddingCoord, FetchState } from "@/lib/api/types";

// ── Three.js 场景常量 ──
const SPHERE_RADIUS = 0.045;
const HIGHLIGHT_SCALE = 1.8;
const AXIS_HALF = 2.4;
const GRID_HALF = 2.5;
const GRID_STEPS = 10;
const BG_LIGHT = 0xf8fafc;
const BG_DARK = 0x0f172a;

/** 将 PCA 坐标归一化到 [-2, 2] 范围（均匀缩放保持结构） */
function normalizeCoords(
  coords: EmbeddingCoord[],
): (EmbeddingCoord & { x3d: number; y3d: number; z3d: number })[] {
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const c of coords) {
    if (c.x < xMin) xMin = c.x; if (c.x > xMax) xMax = c.x;
    if (c.y < yMin) yMin = c.y; if (c.y > yMax) yMax = c.y;
    if (c.z < zMin) zMin = c.z; if (c.z > zMax) zMax = c.z;
  }
  if (xMax === xMin) { xMin -= 0.5; xMax += 0.5; }
  if (yMax === yMin) { yMin -= 0.5; yMax += 0.5; }
  if (zMax === zMin) { zMin -= 0.5; zMax += 0.5; }

  const maxRange = Math.max(xMax - xMin, yMax - yMin, zMax - zMin);
  const s = 4.0 / maxRange;
  const xMid = (xMin + xMax) / 2;
  const yMid = (yMin + yMax) / 2;
  const zMid = (zMin + zMax) / 2;

  return coords.map((c) => ({
    ...c,
    x3d: (c.x - xMid) * s,
    y3d: (c.y - yMid) * s,
    z3d: (c.z - zMid) * s,
  }));
}

/** 把 world 3D 坐标映射为容器内 CSS 坐标（用于 tooltip 定位） */
function toScreenPos(
  world: THREE.Vector3,
  camera: THREE.Camera,
  el: HTMLElement,
): { x: number; y: number } {
  const v = world.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * el.clientWidth,
    y: (-v.y * 0.5 + 0.5) * el.clientHeight,
  };
}

// ── 辅助：创建网格 / 坐标轴 / 灯光 ──

function createGridHelper(isDark: boolean): THREE.Group {
  const group = new THREE.Group();
  const color = isDark ? 0x334155 : 0xcbd5e1;

  // xz 平面网格（y=0 参考面）
  const grid = new THREE.GridHelper(GRID_HALF * 2, GRID_STEPS, color, color);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  group.add(grid);

  // 三条坐标轴线
  const axisMatX = new THREE.LineBasicMaterial({ color: 0xef4444 }); // PC1 = 红
  const axisMatY = new THREE.LineBasicMaterial({ color: 0x22c55e }); // PC2 = 绿
  const axisMatZ = new THREE.LineBasicMaterial({ color: 0x3b82f6 }); // PC3 = 蓝

  for (const [mat, from, to] of [
    [axisMatX, [-AXIS_HALF, 0, 0], [AXIS_HALF, 0, 0]],
    [axisMatY, [0, -AXIS_HALF, 0], [0, AXIS_HALF, 0]],
    [axisMatZ, [0, 0, -AXIS_HALF], [0, 0, AXIS_HALF]],
  ] as const) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
    ]);
    group.add(new THREE.Line(geo, mat));
  }

  return group;
}

function createLights(): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(5, 8, 5);
  group.add(dir);
  return group;
}

// ── 主组件 ──

export default function EmbeddingSpacePanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<EmbeddingCoordsResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // 过滤 & 搜索
  const [showEpisode, setShowEpisode] = useState(true);
  const [showFact, setShowFact] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // 法线化后的坐标
  const normalized = useMemo(
    () => (data ? normalizeCoords(data.coords) : []),
    [data],
  );

  // 按 kind 分组索引
  const { epIndices, factIndices } = useMemo(() => {
    const ep: number[] = [];
    const fact: number[] = [];
    normalized.forEach((c, i) => {
      if (c.kind === "episode") ep.push(i);
      else fact.push(i);
    });
    return { epIndices: ep, factIndices: fact };
  }, [normalized]);

  // 搜索匹配索引集合
  const matchSet = useMemo(() => {
    if (!searchTerm.trim()) return null;
    const lower = searchTerm.toLowerCase();
    return new Set(
      normalized
        .map((c, i) => (c.label.toLowerCase().includes(lower) ? i : -1))
        .filter((i) => i >= 0),
    );
  }, [normalized, searchTerm]);

  // ── Three.js 容器 & 引用 ──
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const epMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const factMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const animIdRef = useRef(0);

  // Tooltip
  const [tooltip, setTooltip] = useState<{
    text: string; x: number; y: number;
  } | null>(null);
  const isDark = useIsDarkTheme();

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // ── 数据拉取 ──
  const fetchCoords = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getEmbeddingCoords(500);
      setData(result);
      setState(result.coords.length > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取嵌入坐标失败"));
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCoords();
  }, [fetchCoords]);

  // ── Three.js 场景初始化 ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container; // narrowed for callbacks

    const w = el.clientWidth;
    const h = el.clientHeight || 420;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? BG_DARK : BG_LIGHT);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(3.5, 2.5, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 15;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Grid + axes + lights
    const grid = createGridHelper(isDark);
    scene.add(grid);
    gridRef.current = grid;
    scene.add(createLights());

    // ── 动画循环 ──
    function animate() {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ── ResizeObserver ──
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth;
      const ch = el.clientHeight || 420;
      renderer.setSize(cw, ch);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    // ── mouse 事件：tooltip ──
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.1;
    const mouse = new THREE.Vector2();

    function onMouseMove(e: MouseEvent) {
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const targets: THREE.Object3D[] = [];
      if (epMeshRef.current) targets.push(epMeshRef.current);
      if (factMeshRef.current) targets.push(factMeshRef.current);
      if (targets.length === 0) return;

      const hits = raycaster.intersectObjects(targets);
      if (hits.length > 0) {
        const hit = hits[0];
        const mesh = hit.object as THREE.InstancedMesh;
        const idx = hit.instanceId!;
        // 从 mesh 反查原始 coord
        const isEp = mesh === epMeshRef.current;
        const origIdx = isEp ? epIndices[idx] : factIndices[idx];
        const coord = normalized[origIdx];
        if (coord) {
          const pos = toScreenPos(
            new THREE.Vector3(coord.x3d, coord.y3d, coord.z3d),
            camera,
            el,
          );
          setTooltip({ text: coord.label, x: pos.x, y: pos.y });
          return;
        }
      }
      setTooltip(null);
    }

    function onMouseLeave() {
      setTooltip(null);
    }

    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseleave", onMouseLeave);

    return () => {
      cancelAnimationFrame(animIdRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseleave", onMouseLeave);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) {
        el.removeChild(renderer.domElement);
      }
      scene.clear();
    };
  // 仅初始化一次；isDark 通过后续 effect 更新背景/网格
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 暗色模式更新背景 & 网格 ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.background = new THREE.Color(isDark ? BG_DARK : BG_LIGHT);
    // 替换网格
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.traverse((c) => {
        if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
        if (c instanceof THREE.Line) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      });
    }
    const newGrid = createGridHelper(isDark);
    scene.add(newGrid);
    gridRef.current = newGrid;
  }, [isDark]);

  // ── 数据 → InstancedMesh 重建 ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || normalized.length === 0) return;

    // 清除旧 mesh
    for (const ref of [epMeshRef, factMeshRef]) {
      if (ref.current) {
        scene.remove(ref.current);
        ref.current.geometry.dispose();
        (ref.current.material as THREE.Material).dispose();
        ref.current = null;
      }
    }

    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 10, 10);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.1,
    });

    // Episode mesh
    if (epIndices.length > 0) {
      const epMesh = new THREE.InstancedMesh(sphereGeo, mat, epIndices.length);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      epIndices.forEach((origIdx, instIdx) => {
        const c = normalized[origIdx];
        dummy.position.set(c.x3d, c.y3d, c.z3d);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        epMesh.setMatrixAt(instIdx, dummy.matrix);
        epMesh.setColorAt(instIdx, color.set(c.color));
      });
      epMesh.instanceMatrix.needsUpdate = true;
      if (epMesh.instanceColor) epMesh.instanceColor.needsUpdate = true;
      scene.add(epMesh);
      epMeshRef.current = epMesh;
    }

    // Fact mesh — 独立 geometry + material 避免与 ep mesh dispose 冲突
    if (factIndices.length > 0) {
      const factGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 10, 10);
      const factMat = new THREE.MeshStandardMaterial({
        roughness: 0.5,
        metalness: 0.1,
      });
      const factMeshInst = new THREE.InstancedMesh(factGeo, factMat, factIndices.length);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      factIndices.forEach((origIdx, instIdx) => {
        const c = normalized[origIdx];
        dummy.position.set(c.x3d, c.y3d, c.z3d);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        factMeshInst.setMatrixAt(instIdx, dummy.matrix);
        factMeshInst.setColorAt(instIdx, color.set(c.color));
      });
      factMeshInst.instanceMatrix.needsUpdate = true;
      if (factMeshInst.instanceColor) factMeshInst.instanceColor.needsUpdate = true;
      scene.add(factMeshInst);
      factMeshRef.current = factMeshInst;
    }
  // 仅在 normalized 结构变化时重建（索引数组也是 derived）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);

  // ── Kind 过滤：切换 mesh visible ──
  useEffect(() => {
    if (epMeshRef.current) epMeshRef.current.visible = showEpisode;
    if (factMeshRef.current) factMeshRef.current.visible = showFact;
  }, [showEpisode, showFact]);

  // ── 搜索高亮 ──
  useEffect(() => {
    const epMesh = epMeshRef.current;
    const factMesh = factMeshRef.current;
    if (!epMesh && !factMesh) return;

    const dimColor = new THREE.Color("#64748b");
    const highlightColor = new THREE.Color("#fbbf24"); // amber-400

    function updateMeshColors(
      mesh: THREE.InstancedMesh,
      indices: number[],
    ) {
      const origColor = new THREE.Color();
      for (let instIdx = 0; instIdx < indices.length; instIdx++) {
        const origIdx = indices[instIdx];
        const c = normalized[origIdx];
        if (matchSet && matchSet.has(origIdx)) {
          mesh.setColorAt(instIdx, highlightColor);
        } else if (matchSet && matchSet.size > 0) {
          // 有搜索但未匹配 → dim
          mesh.setColorAt(instIdx, dimColor);
        } else {
          // 无搜索 → 原始颜色
          mesh.setColorAt(instIdx, origColor.set(c.color));
        }
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // 更新大小（高亮放大）
    function updateMeshScale(
      mesh: THREE.InstancedMesh,
      indices: number[],
    ) {
      const dummy = new THREE.Object3D();
      for (let instIdx = 0; instIdx < indices.length; instIdx++) {
        const origIdx = indices[instIdx];
        const c = normalized[origIdx];
        const scale = matchSet?.has(origIdx) ? HIGHLIGHT_SCALE : 1;
        dummy.position.set(c.x3d, c.y3d, c.z3d);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(instIdx, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (epMesh) {
      updateMeshColors(epMesh, epIndices);
      updateMeshScale(epMesh, epIndices);
    }
    if (factMesh) {
      updateMeshColors(factMesh, factIndices);
      updateMeshScale(factMesh, factIndices);
    }
  }, [matchSet, normalized, epIndices, factIndices]);

  // ── 可见点计数 ──
  const visibleCount = useMemo(() => {
    let n = 0;
    if (showEpisode) n += epIndices.length;
    if (showFact) n += factIndices.length;
    return n;
  }, [showEpisode, showFact, epIndices, factIndices]);

  // ── 点击 canvas → 截图 lightbox ──
  const handleCanvasClick = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const dataUrl = renderer.domElement.toDataURL("image/png");
    setLightboxSrc(dataUrl);
  }, []);

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-3">
        <RiBubbleChartLine className="w-5 h-5 text-accent shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">嵌入空间</h3>
        <span className="text-gm-xs text-text-muted">
          PCA 3D · 共 {data?.total_vectors ?? 0} 个向量 · 可见 {visibleCount}
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchCoords} className="ml-auto" />
        )}
      </div>

      {/* 过滤栏：kind toggle + 搜索 */}
      {state === "success" && normalized.length > 0 && (
        <div className="flex items-center gap-gm-3 mb-gm-3 flex-wrap">
          {/* Kind toggles */}
          <div className="flex items-center gap-gm-1.5">
            <button
              type="button"
              onClick={() => setShowEpisode((v) => !v)}
              className={`inline-flex items-center gap-gm-1 rounded-gm-sm border px-gm-2 py-gm-0.5 text-gm-xs transition-colors ${
                showEpisode
                  ? "border-brand/50 bg-brand/10 text-brand"
                  : "border-border text-text-muted/60"
              }`}
            >
              {showEpisode ? (
                <RiEyeLine className="w-3.5 h-3.5" />
              ) : (
                <RiEyeOffLine className="w-3.5 h-3.5" />
              )}
              记忆 ({epIndices.length})
            </button>
            <button
              type="button"
              onClick={() => setShowFact((v) => !v)}
              className={`inline-flex items-center gap-gm-1 rounded-gm-sm border px-gm-2 py-gm-0.5 text-gm-xs transition-colors ${
                showFact
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-text-muted/60"
              }`}
            >
              {showFact ? (
                <RiEyeLine className="w-3.5 h-3.5" />
              ) : (
                <RiEyeOffLine className="w-3.5 h-3.5" />
              )}
              知识 ({factIndices.length})
            </button>
          </div>

          {/* 搜索 */}
          <div className="relative">
            <RiSearchLine className="absolute left-gm-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/50" />
            <input
              type="text"
              placeholder="搜索标签…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-40 rounded-gm-sm border border-border bg-surface pl-gm-7 pr-gm-6 py-gm-1 text-gm-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-info/50"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-gm-1 top-1/2 -translate-y-1/2 text-text-muted/60 hover:text-text-muted"
                aria-label="清除搜索"
              >
                <RiCloseLine className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {matchSet && (
            <span className="text-gm-xs text-text-muted">
              匹配 {matchSet.size} 个
            </span>
          )}
        </div>
      )}

      <DataState
        state={state}
        error={error}
        onRetry={fetchCoords}
        loadingMessage="加载嵌入坐标…"
        loadingIconClassName="text-accent"
        emptyIcon={RiBubbleChartLine}
        emptyMessage="暂无向量数据，先创建一些记忆再回来查看"
        isEmpty={
          state === "idle" ||
          (state === "success" && (!data || data.coords.length === 0))
        }
      >
        {/* 3D Canvas */}
        {state === "success" && normalized.length > 0 && (
          <div className="border-t border-border pt-gm-4">
            <div
              ref={containerRef}
              className="relative w-full rounded-gm-sm overflow-hidden"
              style={{ height: "420px", cursor: "grab" }}
              role="img"
              aria-label="嵌入空间 3D 可视化 — 拖拽旋转 · 滚轮缩放 · 右键平移"
              title="拖拽旋转 · 滚轮缩放 · 右键平移 · 点击截图"
              onClick={handleCanvasClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCanvasClick();
                }
              }}
              tabIndex={0}
            >
              {/* tooltip overlay */}
              {tooltip && (
                <div
                  className="absolute pointer-events-none z-10 rounded-gm-sm bg-surface-inverse/90 text-text-inverse text-gm-xs px-gm-2 py-gm-1 max-w-64 truncate shadow-gm-sm"
                  style={{
                    left: tooltip.x + 12,
                    top: tooltip.y - 10,
                    transform: "translateY(-100%)",
                  }}
                >
                  {tooltip.text}
                </div>
              )}

              {/* 轴标签 overlay */}
              <div className="absolute bottom-gm-2 left-1/2 -translate-x-1/2 text-gm-xs text-red-400 font-semibold pointer-events-none select-none">
                PC1 →
              </div>
              <div
                className="absolute left-gm-2 top-1/2 -translate-y-1/2 text-gm-xs text-green-400 font-semibold pointer-events-none select-none"
                style={{ writingMode: "vertical-rl" }}
              >
                PC2 ↑
              </div>
              <div className="absolute top-gm-2 right-gm-8 text-gm-xs text-blue-400 font-semibold pointer-events-none select-none">
                PC3 ↗
              </div>
            </div>

            {/* 操作提示 */}
            <p className="text-gm-xs text-text-muted/50 text-center mt-gm-1.5">
              拖拽旋转 · 滚轮缩放 · 右键平移 · 点击截图
            </p>

            {/* PCA 方差 */}
            {data && data.pca_variance_explained.length > 0 && (
              <p className="text-gm-xs text-text-muted/70 text-center mt-gm-2">
                PCA 方差解释：PC1{" "}
                {(data.pca_variance_explained[0] * 100).toFixed(0)}% · PC2{" "}
                {(data.pca_variance_explained[1] * 100).toFixed(0)}%
                {data.pca_variance_explained[2] !== undefined &&
                  ` · PC3 ${(data.pca_variance_explained[2] * 100).toFixed(0)}%`}
              </p>
            )}

            {/* Legend */}
            <div className="flex items-center justify-center gap-gm-4 mt-gm-2">
              <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: "var(--gm-brand)" }}
                />
                记忆 (Episode)
              </span>
              <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: "var(--gm-accent)" }}
                />
                知识 (Fact)
              </span>
            </div>
          </div>
        )}
      </DataState>

      {/* Lightbox — 点击 canvas 截图放大 */}
      {lightboxSrc && (
        <ImageViewer
          src={lightboxSrc}
          alt="嵌入空间 3D 截图"
          isOpen={true}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </section>
  );
}
