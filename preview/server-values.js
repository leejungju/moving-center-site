// 미리보기 가짜 API 가 쓰는 서버 값. scripts/preview.mjs 가 src/ 에서 뽑아 만듭니다. 직접 고치지 마세요.
"use strict";
/** @type {any} */ (window).movingCenterPreviewValues = {
  "textFields": [
    {
      "key": "hero_badge",
      "label": "첫 화면 제목 (맨 위 짧은 문구)",
      "max": 40,
      "default": "전국 포장이사 · 무료 방문 견적"
    },
    {
      "key": "hero_lead",
      "label": "첫 화면 소개",
      "max": 120,
      "default": "포장부터 정리까지, 짐 하나하나를 내 집처럼 꼼꼼하게 옮겨 드립니다."
    },
    {
      "key": "service_home_desc",
      "label": "가정이사 설명",
      "max": 150,
      "default": "아파트·주택 등 가정집 이사. 포장, 운반, 가구 배치와 정리까지 한 번에 진행합니다."
    },
    {
      "key": "service_oneroom_desc",
      "label": "원룸이사 설명",
      "max": 150,
      "default": "1인 가구·소형 이사. 짐 양에 맞는 차량으로 부담 없이 이사할 수 있습니다."
    },
    {
      "key": "service_office_desc",
      "label": "사무실이사 설명",
      "max": 150,
      "default": "사무용 가구, PC, 서류 등 업무 공간 이전. 업무 공백을 줄이도록 일정을 협의합니다."
    },
    {
      "key": "service_storage_desc",
      "label": "보관이사 설명",
      "max": 150,
      "default": "입주 날짜가 맞지 않을 때 짐을 보관했다가 원하는 날 새 집으로 옮겨 드립니다."
    },
    {
      "key": "step1_desc",
      "label": "이용 절차 1단계 (문의) 설명",
      "max": 150,
      "default": "전화나 홈페이지 문의로 이사 일정과 지역을 알려 주세요."
    },
    {
      "key": "step2_desc",
      "label": "이용 절차 2단계 (방문 견적) 설명",
      "max": 150,
      "default": "담당자가 방문해 짐의 양과 현장 여건을 확인하고 견적을 안내합니다."
    },
    {
      "key": "step3_desc",
      "label": "이용 절차 3단계 (계약) 설명",
      "max": 150,
      "default": "작업 범위와 비용, 일정을 확인한 뒤 계약을 진행합니다."
    },
    {
      "key": "step4_desc",
      "label": "이용 절차 4단계 (이사 당일) 설명",
      "max": 150,
      "default": "약속한 시간에 도착해 포장, 운반, 배치를 진행합니다."
    },
    {
      "key": "step5_desc",
      "label": "이용 절차 5단계 (정리 확인) 설명",
      "max": 150,
      "default": "정리 상태를 고객과 함께 확인하고 작업을 마무리합니다."
    }
  ],
  "maxPhotos": 3,
  "maxPhotoBytes": 512000,
  "maxPhotoLabel": "500KB",
  "maxBodyBytes": 2060288,
  "tokenTtlMs": 2592000000,
  "services": [
    "가정이사",
    "원룸이사",
    "사무실이사",
    "보관이사"
  ]
};
