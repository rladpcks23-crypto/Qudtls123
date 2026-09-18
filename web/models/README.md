# 3D 모델 두는 곳

`.glb` 파일을 이 폴더에 넣습니다. 그다음 `web/src/scroll-3d.html` 에서
`▼ 여기를 .glb 로` 주석 블록을 펴고, 그 위의 "조각 만들기" 반복문을 지운 뒤
`web/build-scroll-3d.sh` 를 다시 실행하면 됩니다.

모델을 쓸 때는 브라우저가 파일을 읽어야 하므로 **로컬 서버가 필요합니다.**
파일을 두 번 눌러 여는 방식(`file://`)으로는 모델이 로드되지 않습니다.

    cd web
    python3 -m http.server
    # 브라우저에서 http://localhost:8000/scroll-3d.html

도형만 쓰는 기본 상태는 서버 없이 파일을 바로 열어도 됩니다.
