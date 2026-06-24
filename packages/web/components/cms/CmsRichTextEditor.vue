<template>
  <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
    <div v-if="editor" class="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700 px-2 py-2">
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        :class="editor.isActive('heading', { level: 2 }) ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        H2
      </button>
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        :class="editor.isActive('heading', { level: 3 }) ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        H3
      </button>
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        :class="editor.isActive('bold') ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="editor.chain().focus().toggleBold().run()"
      >
        Bold
      </button>
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        :class="editor.isActive('bulletList') ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        List
      </button>
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="setLink"
      >
        Link
      </button>
    </div>
    <EditorContent :editor="editor" class="cms-editor px-3 py-3 min-h-[8rem] text-gray-900 dark:text-white" />
  </div>
</template>

<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import type { CmsRichTextDocument } from '@vmp/shared'
import { emptyTiptapDoc } from '~/utils/cmsRichText'

const props = defineProps<{
  modelValue: CmsRichTextDocument
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CmsRichTextDocument]
}>()

const editor = shallowRef<Editor | undefined>(undefined)

onMounted(() => {
  editor.value = new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Placeholder.configure({ placeholder: 'Write content…' }),
      Link.configure({ openOnClick: false }),
    ],
    content: props.modelValue?.type ? props.modelValue : emptyTiptapDoc(),
    onUpdate: ({ editor: ed }) => {
      emit('update:modelValue', ed.getJSON() as CmsRichTextDocument)
    },
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[6rem]',
      },
    },
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value || !value) return
    const current = JSON.stringify(editor.value.getJSON())
    const incoming = JSON.stringify(value)
    if (current !== incoming) {
      editor.value.commands.setContent(value, { emitUpdate: false })
    }
  },
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})

function setLink() {
  if (!editor.value) return
  const previous = editor.value.getAttributes('link').href as string | undefined
  const url = window.prompt('URL', previous ?? 'https://')
  if (url === null) return
  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
</script>

<style scoped>
.cms-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  @apply text-gray-400 dark:text-gray-500 float-left h-0 pointer-events-none;
  content: attr(data-placeholder);
}
.cms-editor :deep(.ProseMirror) {
  @apply text-sm leading-relaxed;
}
.cms-editor :deep(.ProseMirror h2) {
  @apply text-lg font-semibold mt-2;
}
.cms-editor :deep(.ProseMirror ul) {
  @apply list-disc pl-5;
}
</style>
