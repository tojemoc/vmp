<template>
  <div class="space-y-3">
    <div class="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-950">
          <tr>
            <th
              v-for="(column, colIndex) in modelValue.columns"
              :key="`col-${colIndex}`"
              scope="col"
              class="px-2 py-2 align-top font-normal"
            >
              <input
                :value="column"
                type="text"
                :aria-label="`Column ${colIndex + 1} header`"
                class="w-full min-w-[6rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs font-semibold"
                @input="updateColumnHeader(colIndex, ($event.target as HTMLInputElement).value)"
              >
              <div class="mt-1 flex justify-center gap-1">
                <button
                  type="button"
                  class="text-[10px] text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-40"
                  :disabled="modelValue.columns.length <= 1"
                  @click="removeColumn(colIndex)"
                >
                  Remove col
                </button>
              </div>
            </th>
            <th class="px-2 py-2 w-10" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
          <tr v-for="(row, rowIndex) in modelValue.rows" :key="`row-${rowIndex}`">
            <td
              v-for="(key, colIndex) in modelValue.columnKeys"
              :key="`cell-${rowIndex}-${colIndex}`"
              class="px-2 py-1.5"
            >
              <input
                :value="row[key] ?? ''"
                type="text"
                :aria-label="`Row ${rowIndex + 1}, column ${colIndex + 1}`"
                class="w-full min-w-[6rem] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
                :class="colIndex === 0 ? 'font-mono' : ''"
                @input="updateCell(rowIndex, key, ($event.target as HTMLInputElement).value)"
              >
            </td>
            <td class="px-2 py-1.5 whitespace-nowrap">
              <button
                type="button"
                class="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                @click="removeRow(rowIndex)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="addRow"
      >
        + Row
      </button>
      <button
        type="button"
        class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="addColumn"
      >
        + Column
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { CmsTableBlock } from '@vmp/shared';

  const props = defineProps<{
    modelValue: CmsTableBlock;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: CmsTableBlock];
  }>();

  function emitBlock(next: CmsTableBlock) {
    emit('update:modelValue', next);
  }

  function slugifyKey(label: string, used: Set<string>): string {
    const base =
      label
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'col';
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    used.add(key);
    return key;
  }

  function updateColumnHeader(colIndex: number, value: string) {
    const columns = [...props.modelValue.columns];
    columns[colIndex] = value;
    emitBlock({ ...props.modelValue, columns });
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    const rows = props.modelValue.rows.map((row, index) =>
      index === rowIndex ? { ...row, [key]: value } : row,
    );
    emitBlock({ ...props.modelValue, rows });
  }

  function addRow() {
    const empty: Record<string, string> = {};
    for (const key of props.modelValue.columnKeys) empty[key] = '';
    emitBlock({
      ...props.modelValue,
      rows: [...props.modelValue.rows, empty],
    });
  }

  function removeRow(rowIndex: number) {
    emitBlock({
      ...props.modelValue,
      rows: props.modelValue.rows.filter((_, index) => index !== rowIndex),
    });
  }

  function addColumn() {
    const used = new Set(props.modelValue.columnKeys);
    const key = slugifyKey(`col_${props.modelValue.columnKeys.length + 1}`, used);
    const label = `Column ${props.modelValue.columns.length + 1}`;
    emitBlock({
      type: 'table',
      columns: [...props.modelValue.columns, label],
      columnKeys: [...props.modelValue.columnKeys, key],
      rows: props.modelValue.rows.map((row) => ({ ...row, [key]: '' })),
    });
  }

  function removeColumn(colIndex: number) {
    if (props.modelValue.columns.length <= 1) return;
    const key = props.modelValue.columnKeys[colIndex];
    if (!key) return;
    emitBlock({
      type: 'table',
      columns: props.modelValue.columns.filter((_, index) => index !== colIndex),
      columnKeys: props.modelValue.columnKeys.filter((_, index) => index !== colIndex),
      rows: props.modelValue.rows.map((row) => {
        const next = { ...row };
        delete next[key];
        return next;
      }),
    });
  }
</script>
