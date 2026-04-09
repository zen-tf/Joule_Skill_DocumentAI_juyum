using { my.document as my } from '../db/schema';

service DocumentService {
    entity DocumentInfo as projection on my.DocumentInfo;

    // ✨ 핵심 수정: Joule이 완벽하게 인식할 수 있도록 반환용 구조체(Type)를 정의합니다.
    type MessageResponse {
        message: LargeString;
    }

    // 1. 프론트엔드(앱) 업로드용 액션
    action uploadToAI (fileName: String, fileContent: String) returns String;

    // 2. 🤖 Joule 연동용 액션들 (모두 MessageResponse를 반환하도록 통일!)
    action getDbDocumentStatus() returns MessageResponse;
    action syncPendingDocuments() returns MessageResponse;
    action fetchExternalDocuments() returns MessageResponse;

    // 3. 사업자 번호 상세 조회용 액션
    action getDocumentByBusinessNumber (businessNumber: String) returns DocumentInfo;
}