sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, Fragment, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("documentai.controller.MainView", {
        
        // 1. 팝업 열기
        onUploadDialog: function () {
            var oView = this.getView();
            if (!this._pDialog) {
                this._pDialog = Fragment.load({
                    id: oView.getId(),
                    name: "documentai.view.UploadDialog", // 경로 주의 (view 폴더 내)
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        // 2. 팝업 닫기
        onCloseDialog: function () {
            this.byId("customUploadDialog").close(); // ID 변경
        },

        // 3. 업로드 실행
        onUploadSubmit: function () {
            var oFileUploader = this.byId("customFileUploader"); // ID 변경
            var oFile = oFileUploader.getFocusDomRef().files[0];
            var that = this;

            if (!oFile) {
                MessageToast.show("파일을 선택해주세요.");
                return;
            }

            var reader = new FileReader();
            sap.ui.core.BusyIndicator.show(0);

            reader.onload = function (e) {
                var sBase64 = e.target.result.split(',')[1];
                
                // OData V4 액션 바인딩
                var oModel = that.getView().getModel();
                var oAction = oModel.bindContext("/uploadToAI(...)");
                
                oAction.setParameter("fileName", oFile.name);
                oAction.setParameter("fileContent", sBase64);

                oAction.execute().then(function () {
                    sap.ui.core.BusyIndicator.hide();
                    MessageToast.show("성공적으로 제출되었습니다!");
                    oFileUploader.clear();
                    that.onCloseDialog();
                }).catch(function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error("전송 실패: " + oError.message);
                });
            };
            reader.readAsDataURL(oFile);
        }
    });
});