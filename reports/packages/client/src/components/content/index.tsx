import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Icon, Text } from '@gravity-ui/uikit';
import { Bars } from '@gravity-ui/icons';

import Sidebar from '../sidebar';

import style from './content.module.css';

type ContentProps = {
  sidebar: boolean;
  main?: ReactNode;
}

function Content({ sidebar, main }: ContentProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileNavOpen]);

  const closeNav = () => {
    setMobileNavOpen(false);
    // Send focus back to the control that opened the drawer
    menuButtonRef.current?.focus();
  };

  return (
    <div className={style.content}>
      <a className={style.skipLink} href="#main-content">Перейти к содержимому</a>
      {sidebar && (
        <>
          <div className={style.mobileTopbar}>
            <Button
              ref={menuButtonRef}
              view="flat"
              size="l"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Открыть меню"
              aria-expanded={mobileNavOpen}
            >
              <Icon data={Bars} size={18} />
            </Button>
            <Text variant="subheader-1">ntlstl.time</Text>
          </div>
          {mobileNavOpen && (
            <div
              className={style.backdrop}
              onClick={closeNav}
              aria-hidden="true"
            />
          )}
          <aside className={`${style.sidebar} ${mobileNavOpen ? style.sidebarOpen : ''}`}>
            <Sidebar onNavigate={closeNav} />
          </aside>
        </>
      )}
      <div className={style.right}>
        <div className={style.body}>
          {main && <main id="main-content" className={style.main}>{main}</main>}
        </div>
      </div>
    </div>
  )
}

export default Content;
