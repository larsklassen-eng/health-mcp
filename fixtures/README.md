# Fixtures

`synthetic-patients.json` holds 8 **invented** brain-tumor patients in the import format (`PatientImportFileSchema`), for trying the app, the MCP tools and, later, the evals. Import it on the web app's **Import** page or with:

```sh
curl -X POST http://localhost:3001/patients/import \
  -H 'Content-Type: application/json' --data @fixtures/synthetic-patients.json
```

None of it describes a real person. Names, dates of birth and record numbers (`FAKE-…`) are made up, and lab values follow textbook patterns rather than anyone's results. The clinical courses are plausible but simplified, and each patient's `notes` say they are synthetic. The data is dated around October 2026, so "recent" queries return results.

| MRN | Patient | Diagnosis | Stage of recovery |
|---|---|---|---|
| FAKE-GBM-0001 | Michael Turner, 50, M | Glioblastoma, right frontal | Chemoradiation in progress; falling lymphocytes and platelets, ALT up, weight target missed |
| FAKE-MEN-0002 | Laura Bennett, 58, F | Meningioma, grade 1 | Surgery only; recovered, back at work |
| FAKE-OLI-0003 | Daniel Osei, 36, M | Oligodendroglioma, grade 2 | Treated last year; surveillance (inactive) |
| FAKE-AST-0004 | Sarah Lindqvist, 39, F | Astrocytoma, grade 3 | Three weeks after surgery; tapering steroids, waiting for radiotherapy |
| FAKE-MET-0005 | Robert Hughes, 67, M | Cerebellar metastasis (lung cancer) | Resection and radiosurgery; balance improving |
| FAKE-PIT-0006 | Grace Whitfield, 53, F | Pituitary macroadenoma | Transient diabetes insipidus (high sodium), on hormone replacement |
| FAKE-GBM-0007 | Thomas Reid, 61, M | Recurrent glioblastoma | Re-resection, bevacizumab; blood pressure rising |
| FAKE-GBM-0008 | Aisha Rahman, 46, F | Glioblastoma | Adjuvant temozolomide; cycle 4 delayed for low platelets |

There is no imaging record type yet, so each patient's imaging history (MRI, CT and chest X-ray, with invented findings) is described in `notes` and in milestones.
