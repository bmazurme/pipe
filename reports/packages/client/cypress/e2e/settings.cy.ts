describe('Settings page', () => {
  beforeEach(() => {
    cy.visit('/settings');
  });

  it('groups GitLab URL/token separately from the report fields', () => {
    cy.contains('label', 'GitLab URL')
      .closest('div')
      .should('contain.text', 'Токен доступа')
      .and('not.contain.text', 'ID пользователя');

    cy.contains('label', 'ID пользователя')
      .closest('div')
      .should('contain.text', 'Сотрудник')
      .and('contain.text', 'Компания');
  });

  it('saves settings and persists them after reload', () => {
    const gitlabUrl = 'https://gitlab.example.com/api/v4';

    cy.contains('button', 'Сохранить').should('be.disabled');
    cy.get('input[id]').first().clear().type(gitlabUrl);
    cy.contains('button', 'Сохранить').click();

    cy.reload();
    cy.get('input[id]').first().should('have.value', gitlabUrl);
  });
});
