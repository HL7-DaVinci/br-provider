interface LFormsUtil {
  convertFHIRQuestionnaireToLForms(
    fhirData: object,
    fhirVersion: string,
  ): object;

  mergeFHIRDataIntoLForms(
    resourceType: string,
    fhirData: object,
    formData: object,
    fhirVersion: string,
  ): object;

  addFormToPage(
    formDefinition: object,
    containerOrId: HTMLElement | string,
    options?: object,
  ): Promise<void>;

  getFormFHIRData(
    resourceType: string,
    fhirVersion: string,
    formDataSource?: HTMLElement | string,
    options?: object,
  ): object;
}

interface LFormsGlobal {
  Util: LFormsUtil;
}

declare global {
  interface Window {
    LForms: LFormsGlobal;
  }
}

export {};
