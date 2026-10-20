import { Dialog as GravityDialog, type DialogProps } from '@gravity-ui/uikit';

// Gravity's Dialog closes on a click anywhere outside it, so a slip of the mouse while filling in a form threw the typed text away.
// Here that click does nothing; the dialog still closes with Escape, the cross and its Cancel button. Everything else is Gravity's.
function DialogRoot(props: DialogProps) {
  return <GravityDialog disableOutsideClick {...props} />;
}

export const Dialog = Object.assign(DialogRoot, {
  Header: GravityDialog.Header,
  Body: GravityDialog.Body,
  Footer: GravityDialog.Footer,
});
