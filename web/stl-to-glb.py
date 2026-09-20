#!/usr/bin/env python3
"""STL 을 부품별로 갈라 GLB 하나로 묶는다.

    python3 stl-to-glb.py 내모델.stl models/model.glb

STL 은 원래 부품 개념이 없는 삼각형 덩어리다. 다만 CAD 에서 내보낸 STL 은
바디끼리 꼭짓점을 공유하지 않으므로, "꼭짓점이 이어진 삼각형끼리 묶기"
만으로 실제 부품이 도로 갈라진다. 이 스크립트가 하는 일이 그것이다.

법선은 넣지 않는다 — glTF 규약상 법선이 없으면 평면 음영으로 그려지고,
기계 부품에는 그 편이 맞으며 파일도 절반이 된다.
"""
import json, struct, sys
import numpy as np


def load_stl(path):
    raw = open(path, 'rb').read()
    if raw[:5] == b'solid' and b'facet' in raw[:2000]:
        rows = [l.split()[1:] for l in raw.decode('utf-8', 'replace').splitlines()
                if l.strip().startswith('vertex')]
        return np.array(rows, dtype=np.float64).reshape(-1, 3, 3)
    n = struct.unpack('<I', raw[80:84])[0]
    rec = np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')])
    return np.frombuffer(raw, dtype=rec, count=n, offset=84)['v'].reshape(n, 3, 3).astype(np.float64)


def components(V):
    """꼭짓점을 공유하는 삼각형끼리 묶어 부품 번호를 돌려준다."""
    n = len(V)
    span = (V.reshape(-1, 3).max(0) - V.reshape(-1, 3).min(0)).max()
    key = np.round(V.reshape(-1, 3) / max(span * 1e-6, 1e-9)).astype(np.int64)
    _, vid = np.unique(key, axis=0, return_inverse=True)
    vid = np.asarray(vid).reshape(n, 3)

    parent = np.arange(n)

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    tri = np.repeat(np.arange(n), 3)
    order = np.argsort(vid.ravel(), kind='stable')
    vs, ts = vid.ravel()[order], tri[order]
    start = 0
    for i in range(1, len(vs) + 1):
        if i == len(vs) or vs[i] != vs[start]:
            a = find(ts[start])
            for j in range(start + 1, i):
                b = find(ts[j])
                if a != b:
                    parent[max(a, b)] = min(a, b)
                    a = min(a, b)
            start = i
    return np.array([find(i) for i in range(n)])


def write_glb(V, roots, dst):
    V = V - (V.reshape(-1, 3).min(0) + V.reshape(-1, 3).max(0)) / 2   # 중심을 원점으로
    uniq, counts = np.unique(roots, return_counts=True)
    parts = uniq[np.argsort(-counts)]                                  # 큰 부품부터

    blob = bytearray()
    accessors, meshes, nodes, views = [], [], [], []
    for pi, r in enumerate(parts):
        v = V[roots == r].reshape(-1, 3).astype('<f4')
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': v.nbytes})
        blob += v.tobytes()
        while len(blob) % 4:
            blob += b'\x00'
        accessors.append({'bufferView': pi, 'componentType': 5126, 'count': len(v),
                          'type': 'VEC3', 'min': v.min(0).tolist(), 'max': v.max(0).tolist()})
        meshes.append({'primitives': [{'attributes': {'POSITION': pi}, 'material': 0}]})
        nodes.append({'mesh': pi, 'name': f'part{pi:03d}'})

    gltf = {'asset': {'version': '2.0', 'generator': 'stl-to-glb'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(parts)))}],
            'nodes': nodes, 'meshes': meshes, 'accessors': accessors, 'bufferViews': views,
            'materials': [{'pbrMetallicRoughness': {'baseColorFactor': [.82, .83, .85, 1],
                                                    'metallicFactor': .25, 'roughnessFactor': .45}}],
            'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '

    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(bytes(blob))
    return len(parts)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    V = load_stl(src)
    roots = components(V)
    n = write_glb(V, roots, dst)
    span = V.reshape(-1, 3).max(0) - V.reshape(-1, 3).min(0)
    print(f'{dst}: 삼각형 {len(V):,}개 → 부품 {n}개')
    print(f'모델 크기: {span[0]:.0f} x {span[1]:.0f} x {span[2]:.0f}')
