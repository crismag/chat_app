import { ActionMenu, type ActionItem } from '../shared/ui/ActionMenu.tsx'
import styles from './ChatPage.module.css'

/*
 * The rest of what can be done to a reflection, out of the way until wanted.
 *
 * Delete, Create visual and Suggest from conversation each had a permanent
 * button — two of them in a footer row that existed only to hold them. None is
 * used often and none is used while writing, so persistent placement bought
 * nothing and cost a row plus three controls competing with Share, which *is*
 * the one people reach for.
 *
 * The menu itself is `ActionMenu`, which decides whether that is a popover or
 * a sheet from the bottom of the screen. On a phone this control sits near the
 * left edge, and a popover growing leftwards from it put its own labels off
 * the screen.
 */
export type MoreMenuItem = ActionItem

export function MoreMenu({ label, items }: { label: string; items: MoreMenuItem[] }) {
  return (
    <ActionMenu
      label={label}
      triggerClassName={styles.iconButton}
      trigger={<span aria-hidden="true">⋯</span>}
      items={items}
    />
  )
}
