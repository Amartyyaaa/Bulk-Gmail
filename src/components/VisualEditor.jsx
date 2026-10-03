import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ImagePlus, Italic, Link2, List, ListOrdered, Minus,
  MousePointerClick, Quote, Redo2, Strikethrough, Underline, Undo2, Unlink,
} from 'lucide-react';
import { BUTTON_CLASS } from '../lib/emailLayout.js';
import { Button, Field, Modal } from './ui.jsx';

const BLOCKS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Big heading' },
  { value: 'h2', label: 'Heading' },
  { value: 'h3', label: 'Small heading' },
];

const URL_RE = /^(https?:\/\/|mailto:|tel:|\{\{)/i;
const normalizeUrl = (u) => {
  const v = u.trim();
  return URL_RE.test(v) ? v : `https://${v}`;
};

/**
 * Gmail-style rich text editor. Emits plain editor HTML via onChange; the
 * caller turns it into email-safe HTML. `apiRef` receives the editor so the
 * page's merge-tag buttons can insert at the cursor.
 */
export default function VisualEditor({ initialContent, onChange, apiRef, invalid, describedBy }) {
  const [dialog, setDialog] = useState(null); // 'link' | 'image' | 'button'

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: 'Write your email here…' }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 've-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Email content',
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  useEffect(() => {
    if (apiRef) apiRef.current = editor;
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [editor, apiRef]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return {};
      return {
        block: e.isActive('heading', { level: 1 }) ? 'h1'
          : e.isActive('heading', { level: 2 }) ? 'h2'
          : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        quote: e.isActive('blockquote'),
        align: ['center', 'right'].find((a) => e.isActive({ textAlign: a })) ?? 'left',
        color: e.getAttributes('textStyle').color ?? '#1f2937',
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  const setBlock = (v) => {
    if (v === 'p') chain().setParagraph().run();
    else chain().toggleHeading({ level: Number(v[1]) }).run();
  };

  const T = ToolButton;

  return (
    <div className={`ve ${invalid ? 've-invalid' : ''}`}>
      <div className="ve-toolbar" role="toolbar" aria-label="Formatting">
        <label className="sr-only" htmlFor="ve-block">Text style</label>
        <select id="ve-block" className="ve-select" value={state.block} onChange={(e) => setBlock(e.target.value)}>
          {BLOCKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <span className="ve-sep" />
        <T label="Bold" icon={Bold} active={state.bold} onClick={() => chain().toggleBold().run()} />
        <T label="Italic" icon={Italic} active={state.italic} onClick={() => chain().toggleItalic().run()} />
        <T label="Underline" icon={Underline} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
        <T label="Strikethrough" icon={Strikethrough} active={state.strike} onClick={() => chain().toggleStrike().run()} />
        <label className="ve-color" title="Text colour">
          <span className="sr-only">Text colour</span>
          <input type="color" value={state.color} onChange={(e) => chain().setColor(e.target.value).run()} />
        </label>
        <span className="ve-sep" />
        <T label="Align left" icon={AlignLeft} active={state.align === 'left'} onClick={() => chain().setTextAlign('left').run()} />
        <T label="Align centre" icon={AlignCenter} active={state.align === 'center'} onClick={() => chain().setTextAlign('center').run()} />
        <T label="Align right" icon={AlignRight} active={state.align === 'right'} onClick={() => chain().setTextAlign('right').run()} />
        <span className="ve-sep" />
        <T label="Bulleted list" icon={List} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
        <T label="Numbered list" icon={ListOrdered} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
        <T label="Quote" icon={Quote} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
        <T label="Divider line" icon={Minus} onClick={() => chain().setHorizontalRule().run()} />
        <span className="ve-sep" />
        <T label="Add link" icon={Link2} active={state.link} onClick={() => setDialog('link')} />
        {state.link && <T label="Remove link" icon={Unlink} onClick={() => chain().extendMarkRange('link').unsetLink().run()} />}
        <T label="Add button" icon={MousePointerClick} onClick={() => setDialog('button')} />
        <T label="Add image" icon={ImagePlus} onClick={() => setDialog('image')} />
        <span className="ve-sep" />
        <T label="Undo" icon={Undo2} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
        <T label="Redo" icon={Redo2} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      </div>
      <EditorContent editor={editor} />

      <LinkDialog open={dialog === 'link'} editor={editor} onClose={() => setDialog(null)} />
      <ButtonDialog open={dialog === 'button'} editor={editor} onClose={() => setDialog(null)} />
      <ImageDialog open={dialog === 'image'} editor={editor} onClose={() => setDialog(null)} />
    </div>
  );
}

function ToolButton({ label, icon: Icon, active, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`ve-btn ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={active ?? undefined}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's text selection
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function useDialogForm(open, init) {
  const [values, setValues] = useState(init);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setValues(init());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  return { values, errors, setErrors, set };
}

function DialogFooter({ onClose, form, label }) {
  return (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form={form}>{label}</Button>
    </>
  );
}

function LinkDialog({ open, editor, onClose }) {
  const { values, errors, setErrors, set } = useDialogForm(open, () => {
    const { from, to } = editor.state.selection;
    return {
      url: editor.getAttributes('link').href ?? '',
      text: editor.state.doc.textBetween(from, to, ' '),
      hasSelection: from !== to,
    };
  });

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!values.url.trim()) next.url = 'Enter the web address to link to.';
    if (!values.hasSelection && !values.text.trim()) next.text = 'Enter the text people will click.';
    if (Object.keys(next).length) return setErrors(next);
    const href = normalizeUrl(values.url);
    const c = editor.chain().focus();
    if (values.hasSelection) c.extendMarkRange('link').setLink({ href }).run();
    else c.insertContent({ type: 'text', text: values.text, marks: [{ type: 'link', attrs: { href } }] }).run();
    onClose();
  };

  return (
    <Modal open={open} title="Add link" onClose={onClose} size="sm" footer={<DialogFooter onClose={onClose} form="ve-link" label="Add link" />}>
      <form id="ve-link" className="form-grid" onSubmit={submit} noValidate>
        {!values.hasSelection && (
          <Field label="Text to show" error={errors.text} required>
            <input value={values.text} onChange={set('text')} autoFocus />
          </Field>
        )}
        <Field label="Web address" error={errors.url} required hint="e.g. yourshop.com/offer">
          <input value={values.url} onChange={set('url')} autoFocus={values.hasSelection} placeholder="https://" />
        </Field>
      </form>
    </Modal>
  );
}

function ButtonDialog({ open, editor, onClose }) {
  const { values, errors, setErrors, set } = useDialogForm(open, () => ({ text: 'Shop now', url: '' }));

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!values.text.trim()) next.text = 'Enter the button text.';
    if (!values.url.trim()) next.url = 'Enter where the button goes.';
    if (Object.keys(next).length) return setErrors(next);
    editor.chain().focus().insertContent({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{
        type: 'text',
        text: values.text.trim(),
        marks: [{ type: 'link', attrs: { href: normalizeUrl(values.url), class: BUTTON_CLASS } }],
      }],
    }).run();
    onClose();
  };

  return (
    <Modal open={open} title="Add button" onClose={onClose} size="sm" footer={<DialogFooter onClose={onClose} form="ve-button" label="Add button" />}>
      <form id="ve-button" className="form-grid" onSubmit={submit} noValidate>
        <Field label="Button text" error={errors.text} required>
          <input value={values.text} onChange={set('text')} autoFocus />
        </Field>
        <Field label="Button link" error={errors.url} required hint="Where people go when they click.">
          <input value={values.url} onChange={set('url')} placeholder="https://" />
        </Field>
      </form>
    </Modal>
  );
}

function ImageDialog({ open, editor, onClose }) {
  const { values, errors, setErrors, set } = useDialogForm(open, () => ({ src: '', alt: '' }));

  const submit = (e) => {
    e.preventDefault();
    if (!/^https:\/\/\S+$/i.test(values.src.trim())) {
      return setErrors({ src: 'Enter a public image address starting with https://' });
    }
    editor.chain().focus().setImage({ src: values.src.trim(), alt: values.alt.trim() }).run();
    onClose();
  };

  return (
    <Modal open={open} title="Add image" onClose={onClose} size="sm" footer={<DialogFooter onClose={onClose} form="ve-image" label="Add image" />}>
      <form id="ve-image" className="form-grid" onSubmit={submit} noValidate>
        <Field label="Image address (URL)" error={errors.src} required
          hint="Right-click an image online → “Copy image address”. It must be publicly accessible.">
          <input value={values.src} onChange={set('src')} autoFocus placeholder="https://…/photo.jpg" />
        </Field>
        <Field label="Description" hint="Shown if the image doesn’t load; also read by screen readers.">
          <input value={values.alt} onChange={set('alt')} />
        </Field>
      </form>
    </Modal>
  );
}
