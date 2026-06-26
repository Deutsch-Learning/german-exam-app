# Admin Style Templates

The admin CMS supports reusable style templates for exam content blocks. The feature copies formatting only; it does not copy German content, questions, options, correct answers, scoring, transcripts, or metadata except for the dedicated visual style metadata used by answer options.

## Supported Blocks

- Website intro instructions from `exams.metadata.instructions`
- Section/task titles from `exam_sections.title`
- Section instructions and reading text from `exam_sections.instructions`
- Question prompts from `exam_questions.prompt`
- Explanations from `exam_questions.explanation`
- Hoeren transcripts from `exam_questions.transcript`
- Answer option layout style stored under `exam_questions.source_metadata.contentStyle.answerOptions`

## Workflow

1. Edit a block in the admin rich editor.
2. Click `Apply style`.
3. Choose a compatible scope: block, task, section, series, level, exam body, or manual blocks.
4. Choose which formatting properties to apply.
5. Click `Preview changes`.
6. Review current vs after previews.
7. Click `Confirm apply`.

The backend rebuilds each destination from its own text and overlays the selected style properties. This preserves each destination block's original content.

## Database

Reusable templates are stored in `content_style_templates`.

Fields:

- `id`
- `name`
- `description`
- `block_type`
- `style_json`
- `created_by`
- `is_active`
- `created_at`
- `updated_at`

The table is created during server startup and has row-level security enabled. Admin users access it through protected backend routes only.

## Audit And Undo

Bulk style application writes a `style.apply` entry to `admin_audit_logs`. The audit metadata includes the source block, scope, selected style options, style JSON, previous values, and new values for affected blocks.

The admin modal includes `Undo last style apply`, which restores the previous values from the latest `style.apply` audit entry for that admin.

## Learner Rendering

Rich text is sanitized before rendering. The sanitizer allows a small safe subset of formatting styles such as color, background color, font family, font size, alignment, line height, margin-bottom, padding-left, and underline. Unsafe tags and attributes are stripped.

Answer option styles are rendered as safe inline React styles on option buttons and labels. Option values and correct answers are not modified.

## Testing

Recommended checks:

1. Apply a title style to one section title.
2. Apply an instruction style to all compatible blocks in one section.
3. Save a reusable template and reuse it on another compatible block.
4. Use manual selection mode for a small set of blocks.
5. Apply answer option layout style and verify option labels and correct answers remain unchanged.
6. Use `Undo last style apply` and confirm the old formatting returns.
7. Open the learner exam and verify styled titles, prompts, instructions, and answer options render safely.

