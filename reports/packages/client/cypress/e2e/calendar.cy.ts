describe('Calendar page', () => {
  beforeEach(() => {
    cy.visit('/calendar');
  });

  it('shows the Calendar title and legend', () => {
    cy.contains('h1', 'Календарь');
    cy.contains('Короткий день');
    cy.contains('Праздник');
    cy.contains('Отпуск/отгул/больничный');
  });

  it('opens the "Add day off" dialog and enables Add once a range is picked', () => {
    cy.contains('button', 'Отгулы').click();
    cy.contains('button', 'Добавить отгул').first().click();
    cy.get('[role="dialog"]').contains('Добавить отгул');
    cy.get('[role="dialog"]').contains('button', 'Добавить').should('be.disabled');

    cy.get('[role="dialog"] input').first().click().type('12/31/2099-12/31/2099');
    cy.get('[role="dialog"]').contains('button', 'Добавить').should('not.be.disabled');

    cy.get('[role="dialog"]').contains('button', 'Отмена').click();
    cy.get('[role="dialog"]').should('not.exist');
  });

  it('opens a confirmation dialog when removing an existing off day', () => {
    cy.contains('button', 'Отгулы').click();
    cy.get('button[aria-label^="Удалить отгул"]').first().click();

    cy.get('[role="dialog"]').contains('Удалить отгул');
    cy.get('[role="dialog"]').contains('button', 'Отмена').click();
    cy.get('[role="dialog"]').should('not.exist');
  });
});
