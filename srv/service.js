const cds = require('@sap/cds')
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client')
const FormData = require('form-data')

module.exports = class DocumentService extends cds.ApplicationService {
    init() {
        const { DocumentInfo } = this.entities

        /**
         * 1. Document AI 업로드 로직 (프록시)
         */
        this.on('uploadToAI', async (req) => {
            const { fileName, fileContent } = req.data
            if (!fileContent) return req.error(400, "파일 내용(Base64)이 누락되었습니다.")

            const buffer = Buffer.from(fileContent, 'base64')
            const form = new FormData()
            form.append('file', buffer, { filename: fileName })
            
            form.append('options', JSON.stringify({
                clientId: "default",
                documentType: "invoice",
                schemaName: "SAP_invoice_schema",
                documentTypeFeatures: {
                    features: ["basic", "lineItems"]
                }
            }))

            try {
                const response = await executeHttpRequest(
                    { destinationName: 'document_ai_destination' }, 
                    {
                        method: 'post',
                        url: '/document-information-extraction/v1/document/jobs',
                        data: form,
                        headers: {
                            ...form.getHeaders()
                        }
                    },
                    { fetchCsrfToken: false }
                )

                const jobId = response.data.id

                await INSERT.into(DocumentInfo).entries({
                    ID: cds.utils.uuid(),
                    fileName: fileName,
                    jobId: jobId,
                    status: 'PENDING'
                })

                return `성공적으로 제출되었습니다. Job ID: ${jobId}`

            } catch (error) {
                console.error("🚨 [AI API 호출 에러]:", error.message);
                if (error.response && error.response.data) {
                    console.error("📄 [SAP 서버의 상세 거절 사유]:", JSON.stringify(error.response.data, null, 2));
                }
                return req.error(500, `AI 서비스 전송 실패: ${error.message}`);
            }
        })

        /**
         * 2. ✨ DB 전체 문서 현황 조회 (Null-safe & Joule 매핑 최적화 버전)
         */
        this.on('getDbDocumentStatus', async (req) => {
            try {
                const docs = await SELECT.from(DocumentInfo);

                if (!docs || docs.length === 0) {
                    return { message: "현재 DB에 저장된 문서가 없습니다." }; // 🎯 객체 반환으로 수정
                }

                const total = docs.length;
                const doneCount = docs.filter(d => d.status === 'DONE').length;
                const pendingCount = docs.filter(d => d.status === 'PENDING').length;
                const failedCount = docs.filter(d => d.status === 'FAILED').length;

                const docListString = docs.map(d => {
                    const status = d.status || '상태 알 수 없음';
                    const fileName = d.fileName || '파일명 없음';
                    
                    let bizNum = d.businessNumber;
                    if (!bizNum) { 
                        if (status === 'PENDING') {
                            bizNum = '분석 대기 중 ⏳';
                        } else {
                            bizNum = '추출 불가 (Not Found)';
                        }
                    }
                    return `- [${status}] 파일명: ${fileName} / 사업자번호: ${bizNum}`;
                }).join('\n');

                const finalString = `📊 **현재 DB 문서 현황**\n` +
                                    `총 ${total}건의 문서가 저장되어 있습니다.\n` +
                                    `(완료: ${doneCount}건, 대기: ${pendingCount}건, 실패: ${failedCount}건)\n\n` +
                                    `**[문서 상세 목록]**\n` +
                                    `${docListString}`;

                return { message: finalString }; // 🎯 객체 반환으로 수정

            } catch (error) {
                console.error("DB 현황 조회 실패:", error.message);
                return { message: `DB 현황을 가져오는 중 서버 오류가 발생했습니다: ${error.message}` }; // 🎯 객체 반환으로 수정
            }
        });

        /**
         * 3. 대기 문서 일괄 동기화 로직 (CONFIRMED 처리 추가)
         */
        this.on('syncPendingDocuments', async (req) => {
            const pendingDocs = await SELECT.from(DocumentInfo).where({ status: 'PENDING' });
            if (pendingDocs.length === 0) return { message: "현재 대기 중(PENDING)인 문서가 없습니다. 모두 최신 상태입니다." };

            let updatedCount = 0;

            for (const doc of pendingDocs) {
                try {
                    const response = await executeHttpRequest(
                        { destinationName: 'document_ai_destination' },
                        { method: 'get', url: `/document-information-extraction/v1/document/jobs/${doc.jobId}` }
                    );

                    const jobStatus = response.data.status;

                    // ✨ 수정 1: DONE 또는 CONFIRMED 일 때 모두 처리
                    if (jobStatus === 'DONE' || jobStatus === 'CONFIRMED') {
                        const extractedDocId = response.data.id; 
                        let extractedBizNum = "Not Found";
                        const extractionFields = response.data.extraction?.headerFields || [];
                        
                        const bizNumField = extractionFields.find(f => 
                            ["documentNumber", "senderBussinessNumber", "b-no", "taxId"].includes(f.name)
                        );
                        if (bizNumField) extractedBizNum = bizNumField.value;

                        // ✨ 수정 2: 'DONE' 하드코딩 제거, 실제 jobStatus 저장
                        await UPDATE(DocumentInfo)
                            .set({
                                status: jobStatus, 
                                documentId: extractedDocId,
                                businessNumber: extractedBizNum
                            })
                            .where({ ID: doc.ID });

                        updatedCount++;
                    } else if (jobStatus === 'FAILED') {
                        await UPDATE(DocumentInfo).set({ status: 'FAILED' }).where({ ID: doc.ID });
                    }
                } catch (error) {
                    console.error(`🚨 Job ID ${doc.jobId} 동기화 실패:`, error.message);
                }
            }

            return { message: `총 ${pendingDocs.length}건의 대기 문서 중, ${updatedCount}건의 최신 상태(DONE/CONFIRMED)가 DB에 업데이트되었습니다.` };
        });

        /**
         * 4. 외부 업로드 문서 끌어오기 (상태 변경 감지 및 CONFIRMED 처리 추가)
         */
        this.on('fetchExternalDocuments', async (req) => {
            try {
                // ✨ 수정 1: status=DONE 조건을 지우고 최근 50개를 다 가져옵니다.
                const response = await executeHttpRequest(
                    { destinationName: 'document_ai_destination' },
                    { method: 'get', url: `/document-information-extraction/v1/document/jobs?limit=50` }
                );

                const aiJobs = response.data.results || [];
                if (aiJobs.length === 0) return { message: "Document AI에 문서가 없습니다." };

                // ✨ 수정 2: 완료(DONE)되거나 확정(CONFIRMED)된 문서만 걸러냅니다.
                const completedJobs = aiJobs.filter(j => j.status === 'DONE' || j.status === 'CONFIRMED');
                let addedCount = 0;
                let updatedCount = 0;

                for (const job of completedJobs) {
                    const existing = await SELECT.one.from(DocumentInfo).where({ jobId: job.id });

                    if (!existing) {
                        // DB에 없는 낯선 문서면 새로 Insert
                        try {
                            const detailResponse = await executeHttpRequest(
                                { destinationName: 'document_ai_destination' },
                                { method: 'get', url: `/document-information-extraction/v1/document/jobs/${job.id}` }
                            );

                            const extractedDocId = detailResponse.data.id;
                            let extractedBizNum = "Not Found";
                            const fields = detailResponse.data.extraction?.headerFields || [];
                            const bizNumField = fields.find(f => ["documentNumber", "senderBussinessNumber", "b-no", "taxId"].includes(f.name)); 
                            if (bizNumField) extractedBizNum = bizNumField.value;

                            // ✨ 수정 3: 'DONE' 하드코딩 제거, 실제 job.status 저장
                            await INSERT.into(DocumentInfo).entries({
                                ID: cds.utils.uuid(),
                                fileName: job.fileName || "외부 업로드 문서",
                                jobId: job.id,
                                status: job.status, 
                                documentId: extractedDocId,
                                businessNumber: extractedBizNum
                            });
                            addedCount++;
                        } catch (detailError) {
                            console.error(`외부 문서 상세 조회 실패:`, detailError.message);
                        }
                    } 
                    // ✨ 수정 4: 이미 DB에 DONE으로 있는데, AI 쪽에선 CONFIRMED로 바뀌었다면? 상태 업데이트!
                    else if (existing.status === 'DONE' && job.status === 'CONFIRMED') {
                        await UPDATE(DocumentInfo).set({ status: 'CONFIRMED' }).where({ jobId: job.id });
                        updatedCount++;
                    }
                }

                return { message: `외부 문서 ${addedCount}건 추가, 기존 문서 상태 변경 ${updatedCount}건 동기화 완료!` };

            } catch (error) {
                console.error("외부 문서 끌어오기 실패:", error.message);
                return { message: `동기화 실패: ${error.message}` };
            }
        });

        /**
         * 5. ✨ 사업자 번호로 문서 ID 조회 로직 (유연한 검색 적용)
         */
        this.on('getDocumentByBusinessNumber', async (req) => {
            const { businessNumber } = req.data;

            const cleanNumber = businessNumber.replace(/[^0-9]/g, '');

            let formattedNumber = cleanNumber;
            if (cleanNumber.length === 10) {
                formattedNumber = `${cleanNumber.substring(0, 3)}-${cleanNumber.substring(3, 5)}-${cleanNumber.substring(5, 10)}`;
            }

            const result = await SELECT.one.from(DocumentInfo)
                .where({ businessNumber: businessNumber })
                .or({ businessNumber: cleanNumber })
                .or({ businessNumber: formattedNumber });

            if (!result) {
                return req.error(404, `사업자 번호 ${businessNumber}에 해당하는 문서를 찾을 수 없습니다.`);
            }

            return result; // 🎯 여기는 기존대로 DocumentInfo 엔티티 구조 그대로 반환 (정상)
        });

        return super.init()
    }
}