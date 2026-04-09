namespace my.document;

entity DocumentInfo {
  key ID : UUID;
  documentId : String(100);
  businessNumber : String(50);
  fileName : String;
  status : String default 'PENDING'; // PENDING, READY, FAILED 등
  jobId : String;                    // Document AI에서 받은 작업 번호
}