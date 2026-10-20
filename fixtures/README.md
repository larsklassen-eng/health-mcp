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

Each patient has 2–4 imaging studies (MRI, CT and chest X-ray) with invented radiology reports; every report starts with "Synthetic report for testing". The studies have no images: the import file only carries reports. The same history is summarized in `notes`.

## Changing the fixture

The file is maintained by hand: there is no generator to rerun. When you edit it, keep everything invented, start new notes and reports with the "Synthetic…" sentence, and run `yarn test`. `packages/shared/test/synthetic-fixture.test.ts` checks that the file is a valid import, that record numbers start with `FAKE-`, that notes and reports are marked synthetic, that nothing is dated before a patient's birth and that lab flags match their reference ranges. The eval tests also check that every value an eval case expects is in the file.
