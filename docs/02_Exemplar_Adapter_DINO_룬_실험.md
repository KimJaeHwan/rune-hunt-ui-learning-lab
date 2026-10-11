# 02. Exemplar·개체별 Adapter·DINO 룬 실험

## 왜 시작했나

확인된 룬 이미지가 쌓이면 다음 방에서 같은 개체를 더 잘 찾는지 시험했다. 둘 다 사진을 특징 벡터로 바꾸지만, **Exemplar는 확인된 벡터를 저장해 유사도를 비교**하고, **개체별 Adapter는 고정 DINO 특징 뒤의 작은 잔차 bottleneck·이진 판별기 가중치를 학습**한다. DINO 본체는 고정했다. `compare.py`에는 Adapter 저장과 `--resume-adapters` 이어 학습 경로가 실제 구현돼 있다. 다만 이 기능만으로 오염·망각이 해결되지는 않는다.

## 초기 3-shot 비교 — 같은 70칸 검색

45화면 중 훈련 6·검증 3·테스트 6세션, 테스트 18화면에 룬 출현 66건. 두 방법은 같은 crop 특징과 양·음성 데이터를 받았다. 실험 A는 crop 정체성 PR AUC, 실험 B는 보드 70칸 검색의 재탐지·오탐이다.

| 특징 | 방법 | 실험 A PR AUC | 실험 B 재탐지 | 오탐/18화면 |
| --- | --- | ---: | ---: | ---: |
| DINOv2 Small | Exemplar | 0.840 | 49/66 | 4 |
| DINOv2 Small | 개체별 Adapter | 0.887 | 54/66 | 3 |
| DINOv3 ViT-S/16 | Exemplar | 0.973 | 61/66 | 2 |
| DINOv3 ViT-S/16 | 개체별 Adapter | 0.956 | 60/66 | 4 |

8-shot에서는 DINOv2가 Exemplar 60/66·Adapter 66/66, DINOv3가 둘 다 64/66이었다. v3가 언제나 더 낫다는 결론은 아니다. **기본 픽셀 특징**의 0.818 대 0.727은 DINO·PyTorch 측정이 아닌 실행 예시였으며 이 표와 섞지 않는다.

## 같은 후보·라벨 예산에서 YOLO 분류기까지

첫 단계에는 동일한 50×50 칸 crop 46개(진짜 11·나머지 35), 누적 단계에는 276개(진짜 66·나머지 210)를 줬다. 테스트는 18화면의 70칸 검색, 룬 출현 66건이다. YOLO는 이 표에서 **YOLO11n-cls 칸 분류기**이지 전체 화면 상자 탐지기가 아니다.

| 학습 자료 | DINOv3 Exemplar | DINOv3 Adapter 이어 학습 | YOLO11n-cls 이어 학습 |
| --- | ---: | ---: | ---: |
| 46 crop 이후 재탐지 | 60/66 | 66/66 | 66/66 |
| 46 crop 이후 오탐 | 4/18화면 | 1/18 | 3/18 |
| 누적 276 crop 이후 재탐지 | 66/66 | 66/66 | 66/66 |
| 누적 276 crop 이후 오탐 | 5/18 | 2/18 | 1/18 |

누적 276 crop으로 **새로 학습한** YOLO11n-cls는 66/66·오탐 0/18이었지만, 작은 합성 세트의 결과다. 첫 단계 Adapter와 YOLO의 오탐 차이 세션 bootstrap 95% 구간은 0을 포함했다. 단일 우승 모델을 고를 근거가 아니다.

## 반투명 60fps 데이터 진단

60fps는 **학습·평가용 관측을 많이 만든다**는 뜻으로 사용했다. 처리 속도 60fps를 주장한 적은 없다. 고정 8개 UI 후보에서 DINOv2는 5~15% 불투명도 양성 128개 중 Exemplar 31, Adapter 38을 찾았다. DINOv3는 같은 조건 6 대 44였으나 오탐도 9 대 19건/240프레임이었다. 배경과 투명도를 합성한 시험이고, 목표 부재 오탐도 별도로 봐야 한다. DINOv2 후보 8개 순차 추론은 로컬 GTX 1660에서 약 74~82ms/프레임으로, 캡처를 제외해도 60fps가 아니었다.

## 얻은 것과 남은 것

개체별 Adapter **실제 학습·저장·이어 학습**은 시도했다. Exemplar는 새 확인 이미지를 메모리에 즉시 추가할 수 있다. 하지만 이 룬 실험은 알려진 칸의 식별이며, 실제 게임의 자유 위치 창 탐지나 새 그림체 일반화를 검증하지 않았다. 테스트 crop 일부가 훈련과 픽셀 중복이다. 공유 **UI 도메인 Adapter**, 상태 그래프에 따른 사전 로딩은 이 코드에서 구현·측정하지 않았다.

실행 근거: 원본 `compare.py`, `sample-report.json`, `dinov2-report.json`, `dinov3-report.json`, `fair_cell_benchmark.py`, `fair-cell-benchmark/COMPARISON.md`, `transparent_ui_eval.py`, `transparent-ui-low-opacity-report.json`, `dinov3-transparent-ui-low-opacity-report.json`.
