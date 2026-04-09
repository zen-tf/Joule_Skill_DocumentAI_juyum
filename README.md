# 🤖 Joule_Skill_DocumentAI_juyum

> **SAP Document Information Extraction API**와 **HANA DB**, 그리고 **SAP Joule**을 통합하여 구현한 지능형 문서 자동화 및 자연어 챗봇 연동 프로젝트입니다.

## 📖 1. 프로젝트 개요 (Project Overview)
본 프로젝트는 사용자가 대량의 문서를 업로드하고 관리하는 과정에서 발생하는 데이터 동기화 문제와 상태 추적의 어려움을 해결하기 위해 기획되었습니다. 
단순한 API 호출을 넘어, **로컬 HANA DB를 통한 상태 관리(`PENDING` ⏳ → `DONE` ✅ → `CONFIRMED` 🔒)**를 구현하였으며, 사용자가 **SAP Joule(자연어 AI 비서)**과 대화하듯 시스템에 명령을 내리고 문서 현황을 파악할 수 있는 사용자 친화적인 통합 파이프라인을 제공합니다.

---

## ✨ 2. 핵심 기능 (Key Features)

### 1) 📦 문서 일괄 업로드 및 추적 (Batch Upload & Tracking)
* 프론트엔드에서 전달받은 문서를 Base64로 인코딩하여 SAP Document AI API로 전송합니다.
* 전송 즉시 HANA DB에 문서 메타데이터를 생성하고, 상태를 `PENDING`(분석 대기)으로 기록하여 누락 없이 문서를 추적합니다.

### 2) 📊 자연어 기반 DB 현황 조회 (Null-safe Status Retrieval)
* Joule을 통해 **"우리 DB 문서 현황 보여줘"**라고 요청하면, DB에 저장된 전체 문서 통계(총 건수, 대기/완료/확정/실패 건수)와 상세 목록을 반환합니다.
* **Null-safe 처리:** 갓 업로드되어 아직 사업자 번호가 추출되지 않은(`null`) 문서도 에러 없이 "분석 대기 중 ⏳" 또는 "추출 불가" 등의 친절한 텍스트로 변환하여 출력합니다.

### 3) 🔄 스마트 대기 문서 동기화 (Smart Sync)
* **"대기 문서 동기화해 줘"**라는 명령어 하나로, DB 내 `PENDING` 상태인 문서들의 Job ID를 Document AI에 찔러 최신 상태를 확인합니다.
* 분석이 완료(`DONE`)되거나 관리자에 의해 확정(`CONFIRMED`)된 문서의 경우, 추출된 핵심 데이터(**사업자등록번호, 문서 ID**)를 DB에 자동 업데이트합니다.

### 4) 📥 외부 업로드 문서 역동기화 (Reverse Sync)
* 사용자가 앱을 거치지 않고 Document AI 플랫폼에 직접 문서를 업로드한 경우를 대비한 방어 로직입니다.
* Document AI의 최근 완료 작업 목록을 긁어와 우리 DB에 없는 낯선 문서라면 새롭게 `INSERT` 처리합니다.
* 이미 DB에 `DONE`으로 저장된 문서가 Document AI 측에서 `CONFIRMED`로 변경되었다면 이를 감지하여 상태를 `UPDATE` 합니다.

### 5) 🔍 지능형 유연 검색 (Flexible Search)
* **"사업자 번호 387-48-00971 찾아줘"** 또는 **"3874800971 찾아줘"** 등 사용자가 하이픈(-)을 넣든 빼든 상관없이 정규식을 통해 유연하게 DB를 검색하여 정확한 문서를 반환합니다.

---

## 🏗️ 3. 시스템 아키텍처 및 기술 스택 (Architecture & Tech Stack)

* **Backend Framework:** SAP Cloud Application Programming Model (CAP), Node.js (`@sap/cds`)
* **Database:** SAP HANA Cloud (로컬 테스트용 SQLite 지원)
* **AI & API:** SAP Document Information Extraction API (BTP Destination 연동)
* **Chatbot Integration:** SAP Joule, SAP Build (Actions & Skills)
* **Communication:** OData V4, REST API

---

## 🗄️ 4. 데이터베이스 스키마 (Database Schema)

`schema.cds` 에 정의된 핵심 엔티티 구조입니다.

```cds
namespace my.document;

entity DocumentInfo {
  key ID         : UUID;
  documentId     : String(100);             // 추출된 Document AI 고유 ID
  businessNumber : String(50);              // 추출된 사업자 등록 번호
  fileName       : String;                  // 원본 파일명
  status         : String default 'PENDING';// 상태값 (PENDING, DONE, CONFIRMED, FAILED)
  jobId          : String;                  // Document AI 작업 번호 (Job ID)
}
```  
  
---  

## 📡 5. OData 서비스 및 Joule 매핑 최적화 (Service Definition)  
  
SAP Build 및 Joule과의 원활한 연동을 위해, 단순 String이 아닌 명시적인 객체(MessageResponse) 형태로 데이터를 반환하도록 설계되었습니다. (OData V4의 원시 텍스트 래핑 이슈 완벽 해결)  
  
```cds  
using { my.document as my } from '../db/schema';

service DocumentService {
    entity DocumentInfo as projection on my.DocumentInfo;

    // ✨ Joule 연동용 명시적 반환 타입 정의
    type MessageResponse {
        message: LargeString;
    }

    action uploadToAI (fileName: String, fileContent: String) returns String;
    action getDbDocumentStatus() returns MessageResponse;
    action syncPendingDocuments() returns MessageResponse;
    action fetchExternalDocuments() returns MessageResponse;
    action getDocumentByBusinessNumber (businessNumber: String) returns DocumentInfo;
}
```  
  
## ⚙️ 6. 설치 및 실행 방법 (Setup & Run)  

### 로컬 환경 테스트
1. 프로젝트 클론 및 의존성 설치
   ```bash
   npm install
   ```
2. 로컬 서버 실행 (In-memory DB 기반)
   ```bash
   cds watch
   ```
3. `http://localhost:4004` 에 접속하여 OData 엔드포인트 확인

### BTP 배포
1. `mta.yaml` 빌드
   ```bash
   mbt build
   ```
2. Cloud Foundry에 배포
   ```bash
   cf deploy mta_archives/Joule_Skill_DocumentAI_juyum_1.0.0.mtar
   ```

---

## 🛠️ 7. SAP Joule 스킬 연동 가이드 (Joule Skill Integration)

이 프로젝트를 SAP Joule에서 정상적으로 동작하게 하려면 SAP Build에서 아래의 설정이 필수적입니다.

1. **SAP Build Actions 생성:**
   * Operation은 반드시 **`POST`**로 설정합니다.
   * Endpoint 예시: `/odata/v4/document/syncPendingDocuments`
2. **Output 스키마 갱신 (마법의 버튼):**
   * Action 테스트 탭에서 `Run`을 실행하여 응답(`200 OK`)을 확인합니다.
   * 우측 상단의 **[Generate Output]** 버튼을 눌러 Output 스키마를 갱신합니다. (응답 형태가 `{ "message": "..." }` 구조로 등록되어야 합니다.)
3. **Joule 스킬(메시지 노드) 변수 매핑:**
   * Joule 스튜디오의 시나리오 흐름 중 마지막 **메시지(Message) 노드**에서 출력 변수를 설정합니다.
   * 수식 또는 변수 선택기를 통해 덩어리(`result`)가 아닌 **`{result.message}`**를 명시적으로 선택하여 알맹이 텍스트만 출력되도록 매핑합니다.

---

## 💬 8. Joule 대화 시나리오 예시 (Conversation Scenarios)

구축된 스킬을 통해 Joule과 다음과 같이 상호작용할 수 있습니다.

**👤 사용자:** "우리 DB 문서 현황 보여줘"
> **🤖 Joule:** 
> 📊 **현재 DB 문서 현황**
> 총 5건의 문서가 저장되어 있습니다.
> (완료: 2건, 확정: 0건, 대기: 3건, 실패: 0건)
> 
> **[문서 상세 목록]**
> - [DONE] 파일명: bizreg_01.pdf / 사업자번호: 123-45-67890
> - [PENDING] 파일명: bizreg_02.pdf / 사업자번호: 분석 대기 중 ⏳

**👤 사용자:** "대기 문서 최신화해 줘"
> **🤖 Joule:** 총 3건의 대기 문서 중, 3건의 최신 상태(DONE/CONFIRMED)가 DB에 업데이트되었습니다.

**👤 사용자:** "사업자 번호 1234567890 문서 정보 알려줘" (하이픈 생략)
> **🤖 Joule:** (DB에서 하이픈 처리된 `123-45-67890` 문서를 완벽하게 찾아 매핑된 DocumentInfo 상세 정보를 반환합니다.)

---
*Developed with ❤️ by juyum*