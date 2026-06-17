import { defineCatalog } from '../defineCatalog'
import { personalData } from './personalData'
import { strings } from './strings'

export const sk = defineCatalog(
  'sk',
  'sk',
  strings,
  {
    planNames: {
      monthly: 'Mesačné',
      yearly: 'Ročné',
      club: 'Klubové predplatné',
    },
    roleLabels: {
      super_admin: 'Vlastník',
      admin: 'Administrátor',
      editor: 'Editor',
      analyst: 'Analytik',
      moderator: 'Moderátor',
      viewer: 'Divák',
    },
  },
  personalData,
)
