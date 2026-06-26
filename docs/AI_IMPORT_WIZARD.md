# AI Import Wizard

The Admin Panel import flow is draft-first.

1. The admin uploads a PDF, DOCX, TXT, or supported image.
2. The backend extracts the complete document text before creating records.
3. The analyzer detects provider, level, module, series, sections, transcripts, questions, answer keys, speaker suggestions, voice metadata, ambience, and confidence scores.
4. The result is saved in `exam_document_imports` with `parse_status = 'draft'` and full `draft_content`.
5. The admin reviews and may edit the draft JSON in the Import Exam wizard.
6. Validation checks for missing series, sections, transcripts, questions, options, and answer keys.
7. Only after the admin clicks publish are rows created in `exams`, `exam_sections`, and `exam_questions`.
8. Published rows become learner-visible through the existing imported exam APIs because they use `exams.is_active = TRUE`.

The first validation document, `ECL_B1_Hoeren_20Sujets_Complet.pdf`, is detected as:

- Provider: `ecl`
- Level: `B1`
- Module: `listen`
- Series: `20`
- Sections: `40`
- Questions: `400`

Listening imports store transcripts and audio planning metadata in section/question metadata, including speaker suggestions, voice style, scene, ambience, SFX timing, and conversation signals.
